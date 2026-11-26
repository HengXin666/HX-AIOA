package com.hengxin.aioa.link

import android.content.Context
import com.hengxin.aioa.config.ConfigStore
import com.hengxin.aioa.net.Api
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Interceptor
import okhttp3.Response
import org.json.JSONObject
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

/**
 * 调试模式的两项可单独开关的监听 (#111):
 * - 请求记录: 每个 HTTP 请求记一行 (方法, 路径, 状态, 耗时), 写 http_log.txt
 * - 失败转发: 失败的请求与长连接断线 / 失败事件攒进 debug_outbox, 只由 :link 搭看门狗唤醒发到一个群
 * 开关都是标记文件, :link 与界面两个进程直接读。外部地址 (Telegram 等路径里带令牌) 只记主机名, 不记路径。
 */
object DebugForward {
    private const val HTTP_FLAG = "debug_http"
    private const val FORWARD_FLAG = "debug_forward"
    private const val HTTP_LOG = "http_log.txt"
    private const val OUTBOX = "debug_outbox"
    // 发送中的快照: 发送期间新失败写进新的 outbox, 发成功才删快照, 发失败下次连同新的一起发
    private const val SENDING = "debug_outbox.sending"
    // 转发组名单独存, 关着转发时改的组名也留得住
    private const val GROUP_FILE = "debug_forward_group"
    const val DEFAULT_GROUP = "debug"
    private const val KEEP_LINES = 300
    private const val TRIM_AT_BYTES = 48 * 1024L
    private const val MAX_FORWARD_LINES = 40
    private const val MESSAGES = "api/v1/messages"
    private const val HTTP_FAIL = 400
    private val FAIL_WORDS = listOf("断", "失败", "已死", "错误")
    private val lock = Any()
    private val busy = AtomicBoolean(false)
    // 转发请求自己在本线程上标记, 拦截器据此不记它 (execute 同步调用, 拦截器跑在调用线程)
    private val forwarding = ThreadLocal<Boolean>()

    fun httpOn(context: Context) = File(context.filesDir, HTTP_FLAG).exists()
    fun forwardOn(context: Context) = File(context.filesDir, FORWARD_FLAG).exists()

    /** 转发到的群; 开着转发时文件内容就是群 channel。 */
    fun group(context: Context): String = runCatching { File(context.filesDir, GROUP_FILE).readText().trim() }.getOrNull()?.ifEmpty { null } ?: DEFAULT_GROUP

    fun setHttp(context: Context, on: Boolean) = flag(context, HTTP_FLAG, on, "1")

    fun setForward(context: Context, on: Boolean) = flag(context, FORWARD_FLAG, on, "1")

    fun setGroup(context: Context, group: String) {
        runCatching { File(context.filesDir, GROUP_FILE).writeText(group.trim()) }
    }

    fun httpRecent(context: Context, max: Int): List<String> = runCatching { file(context, HTTP_LOG).readLines().takeLast(max).reversed() }.getOrDefault(emptyList())

    /** 长连接事件: 像失败的才进转发箱。 */
    fun onLinkEvent(context: Context, line: String) {
        if (FAIL_WORDS.any { it in line } && forwardOn(context)) append(context, OUTBOX, "长连 $line")
    }

    /** 把攒下的失败发到群里, 一次一条消息; 发失败就留着下次再发。只在 :link 的后台线程调用。 */
    fun flush(context: Context) {
        if (!forwardOn(context) || !busy.compareAndSet(false, true)) return
        try {
            send(context)
        } finally {
            busy.set(false)
        }
    }

    private fun send(context: Context) {
        val snap = file(context, SENDING)
        synchronized(lock) {
            val out = file(context, OUTBOX)
            if (out.exists()) {
                if (snap.exists()) snap.appendText(out.readText()).also { out.delete() } else out.renameTo(snap)
            }
        }
        val lines = runCatching { snap.readLines().filter { it.isNotBlank() } }.getOrDefault(emptyList())
        if (lines.isEmpty()) return
        val shown = lines.takeLast(MAX_FORWARD_LINES)
        val dropped = lines.size - shown.size
        val text = (if (dropped > 0) listOf("(更早的 $dropped 条略去)") else emptyList<String>()).plus(shown).joinToString("\n")
        val body = JSONObject().put("channel", group(context)).put("title", "调试: ${lines.size} 条失败记录").put("text", text)
        forwarding.set(true)
        val ok = try { Api.call(context, "POST", listOf(MESSAGES), body).error == null } finally { forwarding.remove() }
        if (ok) snap.delete()
    }

    /** OkHttp 拦截器: 开关关着时只多读一次文件是否存在。 */
    class Http(private val context: Context) : Interceptor {
        override fun intercept(chain: Interceptor.Chain): Response {
            val req = chain.request()
            val http = httpOn(context)
            val fwd = forwardOn(context)
            if ((!http && !fwd) || forwarding.get() == true) return chain.proceed(req)
            val path = if (own(req.url.host)) req.url.encodedPath else "${req.url.host} (外部, 不记路径)"
            val start = System.currentTimeMillis()
            val res = runCatching { chain.proceed(req) }
            val ms = System.currentTimeMillis() - start
            val line = "${req.method} $path ${res.getOrNull()?.code ?: res.exceptionOrNull()?.javaClass?.simpleName} ${ms}ms"
            if (http) append(context, HTTP_LOG, line)
            val failed = res.isFailure || (res.getOrNull()?.code ?: 0) >= HTTP_FAIL
            // 转发自己失败时不再记, 免得越记越多
            if (fwd && failed) append(context, OUTBOX, "请求 $line")
            return res.getOrThrow()
        }

        private fun own(host: String): Boolean = runCatching { ConfigStore.load(context)?.server?.toHttpUrl()?.host == host }.getOrDefault(false)
    }

    private fun append(context: Context, name: String, line: String) = synchronized(lock) {
        runCatching {
            val f = file(context, name)
            f.appendText("${LinkLog.clock(System.currentTimeMillis())} $line\n")
            if (f.length() > TRIM_AT_BYTES) f.writeText(f.readLines().takeLast(KEEP_LINES).joinToString("\n", postfix = "\n"))
        }
    }

    private fun flag(context: Context, name: String, on: Boolean, content: String) {
        runCatching { if (on) File(context.filesDir, name).writeText(content) else File(context.filesDir, name).delete() }
    }

    private fun file(context: Context, name: String) = File(context.filesDir, name)
}
