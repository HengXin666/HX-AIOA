package com.hengxin.aioa.ui.drive

import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.mutableStateListOf
import com.hengxin.aioa.net.Net
import com.hengxin.aioa.net.TransferService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import okhttp3.Request
import org.json.JSONObject
import kotlin.coroutines.coroutineContext

enum class DlState { RUNNING, PAUSED, DONE, FAILED }

/** 一项保存到手机的任务: done 为已下字节, speed 为字节每秒 (滑动窗口平均)。 */
data class DlTask(
    val id: String, val name: String, val size: Long, val mime: String,
    val done: Long = 0, val speed: Double = 0.0, val state: DlState = DlState.RUNNING, val error: String? = null, val uri: String? = null,
) {
    val progress: Float get() = if (size <= 0) 0f else (done.toFloat() / size).coerceIn(0f, 1f)
}

/**
 * 保存到手机 (#158): 下到系统下载目录 (Download/AIOA, MediaStore, 不要存储权限), 半截带 .part, 按 Range 续传,
 * 直链过期自动换链, 服务器不认 Range 时从头来; 可暂停, 继续, 取消; 传输时起前台服务, 通知里有进度与速度。
 * 已保存过的同一文件直接打开。任务与保存记录存本机, 重开 App 后半截的任务显示为暂停。
 */
object DriveDownloads {
    val tasks = mutableStateListOf<DlTask>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val jobs = HashMap<String, Job>()
    private val sinks = HashMap<String, PartSink>()
    private val gate = Semaphore(PARALLEL)
    private var loaded = false

    val busy: Boolean get() = tasks.any { it.state == DlState.RUNNING }

    /** 读回上次没下完的任务 (显示为暂停)。 */
    fun load(context: Context) {
        if (loaded) return
        loaded = true
        val p = context.getSharedPreferences(TASKS, Context.MODE_PRIVATE)
        for ((id, raw) in p.all) {
            val o = runCatching { JSONObject(raw as String) }.getOrNull() ?: continue
            val sink = SaveTarget.reopen(context.applicationContext, o.optString("key"))
            sinks[id] = sink
            tasks.add(DlTask(id, o.optString("name"), o.optLong("size"), o.optString("mime"), done = sink.length(), state = DlState.PAUSED))
        }
    }

    /** 保存过且文件还在: 返回它的 Uri。 */
    fun saved(context: Context, n: DriveNode): Uri? {
        val p = context.getSharedPreferences(SAVED, Context.MODE_PRIVATE)
        val o = p.getString(n.id, null)?.let { runCatching { JSONObject(it) }.getOrNull() } ?: return null
        val uri = Uri.parse(o.optString("uri"))
        val path = o.optString("path").ifEmpty { null }
        if (o.optLong("size") == n.size && SaveTarget.alive(context, uri, n.size, path)) return uri
        p.edit().remove(n.id).apply()
        return null
    }

    /** 保存到手机; 已保存过就直接打开。 */
    fun save(context: Context, n: DriveNode) {
        val app = context.applicationContext
        load(app)
        saved(app, n)?.let { if (!open(app, it, n.mime)) toast(app, "已保存, 但没有能打开它的应用"); return }
        val cur = tasks.firstOrNull { it.id == n.id }
        if (cur?.state == DlState.RUNNING) return
        if (cur != null) return resume(app, cur)
        tasks.add(DlTask(n.id, n.name, n.size, n.mime))
        start(app, n.id, n)
    }

    fun pause(context: Context, t: DlTask) {
        jobs.remove(t.id)?.cancel()
        update(t.id) { it.copy(state = DlState.PAUSED, speed = 0.0) }
        if (tasks.none { it.state == DlState.RUNNING && it.id != t.id } && !DriveTransfers.busy) TransferService.finish(context.applicationContext)
    }

    fun resume(context: Context, t: DlTask) {
        val app = context.applicationContext
        update(t.id) { it.copy(state = DlState.RUNNING, error = null) }
        start(app, t.id, DriveNode(t.id, t.name, false, t.size, t.mime, 0))
    }

    /** 取消: 停下并删掉半截; 完成的只从列表里划掉。 */
    fun cancel(context: Context, t: DlTask) {
        jobs.remove(t.id)?.cancel()
        if (t.state != DlState.DONE) sinks.remove(t.id)?.let { s -> scope.launch { s.drop() } }
        context.getSharedPreferences(TASKS, Context.MODE_PRIVATE).edit().remove(t.id).apply()
        tasks.removeAll { it.id == t.id }
        if (!busy && !DriveTransfers.busy) TransferService.finish(context.applicationContext)
    }

    private fun start(app: Context, id: String, n: DriveNode) {
        jobs[id]?.cancel()
        jobs[id] = scope.launch {
            gate.withPermit { run(app, n) }
            jobs.remove(id)
            if (!busy && !DriveTransfers.busy) TransferService.finish(app)
        }
    }

    private suspend fun run(app: Context, n: DriveNode) {
        val r = runCatching {
            val sink = sinks.getOrPut(n.id) { SaveTarget.create(app, n.id, n.name) }
            app.getSharedPreferences(TASKS, Context.MODE_PRIVATE).edit()
                .putString(n.id, JSONObject().put("name", n.name).put("size", n.size).put("mime", n.mime).put("key", sink.key).toString()).apply()
            val meter = SpeedMeter()
            var shown = 0L
            fetchTo(app, n, sink) { done ->
                val now = System.currentTimeMillis()
                meter.add(now, done)
                if (now - shown < UI_GAP_MS && done < n.size) return@fetchTo
                shown = now
                val sp = meter.speed(now)
                update(n.id) { it.copy(done = done, speed = sp) }
                TransferService.show(app, TITLE, "${n.name} · ${speedText(sp)} · ${etaText(etaSec(n.size - done, sp))}", (done * PERCENT / n.size.coerceAtLeast(1)).toInt())
            }
            val uri = sink.finish(n.name, n.mime)
            val path = (sink as? FileSink)?.saved?.path
            app.getSharedPreferences(SAVED, Context.MODE_PRIVATE).edit()
                .putString(n.id, JSONObject().put("uri", uri.toString()).put("size", n.size).put("path", path ?: "").toString()).apply()
            app.getSharedPreferences(TASKS, Context.MODE_PRIVATE).edit().remove(n.id).apply()
            sinks.remove(n.id)
            uri
        }
        r.onSuccess { uri -> update(n.id) { it.copy(state = DlState.DONE, done = n.size, speed = 0.0, uri = uri.toString()) } }
        r.onFailure { e ->
            if (e is kotlinx.coroutines.CancellationException) throw e
            update(n.id) { it.copy(state = DlState.FAILED, speed = 0.0, error = e.message ?: "保存失败") }
        }
    }

    private fun update(id: String, f: (DlTask) -> DlTask) = scope.launch(Dispatchers.Main) {
        val i = tasks.indexOfFirst { it.id == id }
        if (i >= 0) tasks[i] = f(tasks[i])
    }

    /** 用系统里能打开它的应用打开。 */
    fun open(context: Context, uri: Uri, mime: String): Boolean {
        val view = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime.ifEmpty { "*/*" }).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        return runCatching { context.startActivity(Intent.createChooser(view, "打开").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }.isSuccess
    }

    /** 打开系统的下载列表 (文件在 Download/AIOA 里)。 */
    fun showFolder(context: Context) {
        val ok = runCatching { context.startActivity(Intent(DownloadManager.ACTION_VIEW_DOWNLOADS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }.isSuccess
        if (!ok) toast(context, "文件在 下载/AIOA 里")
    }

    private const val TASKS = "drive_dl"
    private const val SAVED = "drive_saved"
    private const val PARALLEL = 2
    private const val UI_GAP_MS = 500L
    private const val PERCENT = 100
    private const val TITLE = "网盘保存"
}

private const val BUF = 64 * 1024
private const val HTTP_OK = 200

/** Content-Range: bytes 100-199/1000 的起点; 没有或看不懂为 -1。 */
internal fun rangeStart(header: String?): Long = header?.substringAfter("bytes ", "")?.substringBefore('-')?.trim()?.toLongOrNull() ?: -1
private const val RETRY_MAX = 3
private const val RETRY_MS = 2_000L

/**
 * 把节点下到 sink, 从 sink 已有的字节续传 (#158)。每次响应按 [resumeStep] 决定接着写, 从头写, 换链或重试;
 * onBytes 收到累计字节。取消协程即暂停, 半截留在 sink。
 */
internal suspend fun fetchTo(app: Context, n: DriveNode, sink: PartSink, onBytes: (Long) -> Unit) {
    var offset = validOffset(sink.length(), n.size)
    var relinks = 0
    var retries = 0
    while (offset < n.size || n.size == 0L) {
        coroutineContext.ensureActive()
        val url = DriveTransfers.link(app, n)
        val req = Request.Builder().url(url).apply { rangeHeader(offset)?.let { header("Range", it) } }.build()
        val before = offset
        var read = false
        val step = withContext(Dispatchers.IO) {
            val res = runCatching { Net.client(app).newCall(req).execute() }.getOrElse { return@withContext Resume.RETRY }
            res.use {
                var st = resumeStep(res.code, offset, n.size, relinks)
                // 206 但起点对不上 (中间有缓存或代理改了范围): 当作不支持 Range, 从头来
                if (st == Resume.APPEND && rangeStart(res.header("Content-Range")) != offset) st = Resume.RESTART
                if (st != Resume.APPEND && st != Resume.RESTART) return@use st
                val input = res.body?.byteStream() ?: return@use Resume.RETRY
                if (st == Resume.RESTART) {
                    // 206 从 0 开始的或 200 的整个文件可以直接从头写; 其他 (416, 范围对不上) 截掉后下一轮不带 Range 重下
                    val whole = res.code == HTTP_OK || rangeStart(res.header("Content-Range")) == 0L
                    offset = 0
                    if (!whole) return@use st.also { sink.open(0).close() }
                }
                read = true
                sink.open(offset).use { out ->
                    val buf = ByteArray(BUF)
                    while (true) {
                        coroutineContext.ensureActive()
                        val k = input.read(buf)
                        if (k < 0) break
                        out.write(buf, 0, k)
                        offset += k
                        onBytes(offset)
                    }
                }
                st
            }
        }
        // 写了 0 字节也算一次失败, 免得空转
        if (read && offset == before && n.size > 0) {
            if (++retries > RETRY_MAX) throw DriveError("下载没有进展, 可以稍后继续")
            delay(RETRY_MS * retries)
            continue
        }
        when (step) {
            Resume.RELINK -> {
                DriveTransfers.forgetLink(n.id)
                relinks++
            }
            Resume.RETRY -> {
                if (++retries > RETRY_MAX) throw DriveError("下载失败, 网络或服务器有问题, 可以稍后继续")
                delay(RETRY_MS * retries)
            }
            Resume.DONE -> offset = n.size
            Resume.FAIL -> throw DriveError("下载失败 (直链不可用)")
            Resume.APPEND, Resume.RESTART -> {
                relinks = 0
                retries = 0
            }
        }
        if (n.size == 0L) break
    }
    if (offset > n.size) throw DriveError("下载的大小和网盘里的不一致")
}
