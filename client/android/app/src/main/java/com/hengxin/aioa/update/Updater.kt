package com.hengxin.aioa.update

import android.content.Context
import androidx.core.content.pm.PackageInfoCompat
import com.hengxin.aioa.Constants
import com.hengxin.aioa.net.Net
import com.hengxin.aioa.net.ProxyCore
import com.hengxin.aioa.net.ProxyDemand
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.security.MessageDigest

data class UpdateFile(val url: String, val size: Long, val sha256: String)
data class UpdatePatch(val fromSha256: String, val file: UpdateFile)
data class UpdateManifest(
    val versionCode: Long,
    val versionName: String,
    val notes: List<String>,
    val apk: UpdateFile,
    val patches: List<UpdatePatch>,
)

// 代理内核按需启动: 先按当前路径请求, 失败再拉起内核走代理重试一次
// 检查更新 -> 优先下载增量补丁 (要求本机 APK 的 sha256 与补丁起点一致) -> 带进度下载 -> 校验 -> 交给 Installer
class Updater(private val context: Context) {

    fun interface Progress {
        fun on(text: String)
    }

    fun currentVersion(): Long =
        PackageInfoCompat.getLongVersionCode(context.packageManager.getPackageInfo(context.packageName, 0))

    fun fetchManifest(): UpdateManifest {
        val json = JSONObject(download(Constants.UPDATE_MANIFEST_URL).decodeToString())
        val patches = json.optJSONArray("patches")
        return UpdateManifest(
            versionCode = json.getLong("versionCode"),
            versionName = json.optString("versionName"),
            notes = ReleaseNotes.parse(json),
            apk = file(json.getJSONObject("apk")),
            patches = (0 until (patches?.length() ?: 0)).map {
                val p = patches!!.getJSONObject(it)
                UpdatePatch(p.getString("fromSha256"), file(p))
            },
        )
    }

    // foreground: 界面发起的检查可以直接弹系统安装界面, 后台检查只发通知
    // 返回 true 表示已交给系统安装
    fun update(foreground: Boolean, progress: Progress): Boolean {
        val lock = File(dir(), LOCK_FILE)
        RandomAccessFile(lock, "rw").channel.use { channel ->
            val held = channel.tryLock() ?: run { progress.on("另一个更新任务正在进行"); return false }
            held.use {
                val manifest = fetchManifest()
                if (manifest.versionCode <= currentVersion()) {
                    progress.on("已是最新版本")
                    return false
                }
                ReleaseNotes.remember(context, ReleaseNote(manifest.versionCode, manifest.versionName, manifest.notes))
                progress.on("发现新版本 ${manifest.versionName}, 准备下载")
                val apk = prepare(manifest, progress)
                if (!context.packageManager.canRequestPackageInstalls()) {
                    File(dir(), PERMISSION_MARK).createNewFile()
                    progress.on("${manifest.versionName} 已下载到本机, 需要允许本应用安装未知应用, 允许后返回会自动继续")
                    InstallPermission.request(context)
                    return false
                }
                progress.on(Installer.install(context, apk, foreground))
                return true
            }
        }
    }

    // 新版本首次启动的公告: 本地存过就直接用, 没有就拉 update.json, 版本号对得上才采用; 网络失败下次启动再试
    fun announcement(): ReleaseNote? {
        val current = currentVersion()
        if (!ReleaseNotes.unseen(context, current)) return null
        ReleaseNotes.find(context, current)?.let { return it }
        val manifest = runCatching { fetchManifest() }.getOrNull() ?: return null
        if (manifest.versionCode != current || manifest.notes.isEmpty()) {
            ReleaseNotes.markShown(context, current)
            return null
        }
        return ReleaseNote(manifest.versionCode, manifest.versionName, manifest.notes).also { ReleaseNotes.remember(context, it) }
    }

    private fun prepare(manifest: UpdateManifest, progress: Progress): File {
        val target = File(dir(), "$APK_PREFIX${manifest.versionCode}$APK_SUFFIX")
        if (target.exists() && sha256(target).equals(manifest.apk.sha256, ignoreCase = true)) {
            progress.on("本机已有下载好的安装包, 校验通过")
            return target
        }
        val base = File(context.applicationInfo.sourceDir)
        val patch = manifest.patches.firstOrNull { it.fromSha256 == sha256(base) }
        if (patch != null) {
            val ok = runCatching {
                val patchFile = fetchTo(patch.file, File(dir(), PATCH_FILE), "增量补丁", progress)
                progress.on("正在合成新安装包...")
                BsPatch.apply(base, patchFile, target)
                patchFile.delete()
                verify(target, manifest.apk.sha256)
            }.isSuccess
            if (ok) return target
            progress.on("补丁失败, 改为完整下载")
        }
        return fetchTo(manifest.apk, target, "完整安装包", progress)
    }

    private fun fetchTo(file: UpdateFile, target: File, label: String, progress: Progress): File {
        // 安装包较大, 配了订阅就先拉起代理, 避免直连慢速下载长时间占着网络
        ProxyDemand.ensure(context)
        try {
            downloadFile(file, target, label, progress)
        } finally {
            Installer.clearProgress(context)
        }
        progress.on("下载完成, 正在校验...")
        verify(target, file.sha256)
        return target
    }

    private fun downloadFile(file: UpdateFile, target: File, label: String, progress: Progress) {
        Net.client(context).newCall(Request.Builder().url(file.url).build()).execute().use { resp ->
            if (!resp.isSuccessful) throw IOException("下载失败 ${resp.code}")
            val total = file.size.coerceAtLeast(1)
            var done = 0L
            var shown = -1L
            target.outputStream().use { out ->
                resp.body!!.byteStream().use { input ->
                    val buf = ByteArray(BUFFER)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        done += n
                        val percent = done * PERCENT / total
                        if (percent >= shown + PROGRESS_STEP) {
                            shown = percent
                            progress.on("下载$label $percent% (${mb(done)} / ${mb(total)} MB)")
                            Installer.progress(context, label, percent.toInt())
                        }
                    }
                }
            }
        }
    }

    private fun mb(bytes: Long) = "%.1f".format(bytes / BYTES_PER_MB)

    private fun download(url: String): ByteArray = runCatching { get(url) }.getOrElse { first ->
        if (!ProxyCore.listening() && ProxyDemand.ensure(context)) get(url) else throw first
    }

    private fun get(url: String): ByteArray =
        Net.client(context).newCall(Request.Builder().url(url).build()).execute().use { resp ->
            if (!resp.isSuccessful) throw IOException("请求失败 ${resp.code}")
            resp.body!!.bytes()
        }

    private fun verify(file: File, expected: String) {
        if (!sha256(file).equals(expected, ignoreCase = true)) {
            file.delete()
            throw IOException("校验失败")
        }
    }

    private fun dir() = File(context.cacheDir, Constants.UPDATE_DIR).apply { mkdirs() }

    private fun file(o: JSONObject) = UpdateFile(o.getString("url"), o.getLong("size"), o.getString("sha256"))

    companion object {
        private const val LOCK_FILE = "lock"
        private const val APK_PREFIX = "update-"
        private const val APK_SUFFIX = ".apk"
        private const val PATCH_FILE = "update.patch"
        private const val PERMISSION_MARK = "need_permission"
        private const val BUFFER = 64 * 1024
        private const val PERCENT = 100
        private const val PROGRESS_STEP = 2
        private const val BYTES_PER_MB = 1024.0 * 1024.0

        // 只有因为缺权限而中断过, 回到前台拿到权限后才自动继续, 避免每次回前台都弹安装界面
        fun takePermissionResume(context: Context): Boolean {
            val mark = File(File(context.cacheDir, Constants.UPDATE_DIR), PERMISSION_MARK)
            if (!mark.exists() || !context.packageManager.canRequestPackageInstalls()) return false
            mark.delete()
            return pendingApk(context) != null
        }

        // 已下载但还没装上的最新安装包
        fun pendingApk(context: Context): File? {
            val current = Updater(context).currentVersion()
            return cached(context).filter { it.second > current }.maxByOrNull { it.second }?.first
        }

        // 升级完成后删掉安装包和补丁: 启动时版本号已不小于缓存的就清掉
        fun cleanup(context: Context) {
            val current = Updater(context).currentVersion()
            cached(context).filter { it.second <= current }.forEach { it.first.delete() }
            File(File(context.cacheDir, Constants.UPDATE_DIR), PATCH_FILE).delete()
        }

        private fun cached(context: Context): List<Pair<File, Long>> =
            File(context.cacheDir, Constants.UPDATE_DIR).listFiles().orEmpty().mapNotNull { file ->
                val code = file.name.removePrefix(APK_PREFIX).removeSuffix(APK_SUFFIX).toLongOrNull()
                if (file.name.startsWith(APK_PREFIX) && code != null) file to code else null
            }

        fun sha256(file: File): String {
            val digest = MessageDigest.getInstance("SHA-256")
            file.inputStream().use { input ->
                val buf = ByteArray(BUFFER)
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    digest.update(buf, 0, n)
                }
            }
            return digest.digest().joinToString("") { "%02x".format(it) }
        }
    }
}
