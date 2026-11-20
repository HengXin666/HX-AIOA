package com.hengxin.aioa.update

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import androidx.core.content.pm.PackageInfoCompat
import com.hengxin.aioa.Constants
import com.hengxin.aioa.net.Net
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.security.MessageDigest

data class UpdateFile(val url: String, val size: Long, val sha256: String)
data class UpdatePatch(val fromSha256: String, val file: UpdateFile)
data class UpdateManifest(val versionCode: Long, val versionName: String, val notes: String, val apk: UpdateFile, val patches: List<UpdatePatch>)

// 检查更新 -> 优先下载增量补丁 (要求本机 APK 的 sha256 与补丁起点一致) -> 校验 -> 交给 PackageInstaller
// Android 12+ 且本应用是上一次的安装来源时可静默安装; 否则系统会弹一次确认
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
            notes = json.optString("notes"),
            apk = file(json.getJSONObject("apk")),
            patches = (0 until (patches?.length() ?: 0)).map {
                val p = patches!!.getJSONObject(it)
                UpdatePatch(p.getString("fromSha256"), file(p))
            },
        )
    }

    // 返回 true 表示已提交安装
    fun update(progress: Progress): Boolean {
        val lock = File(dir(), LOCK_FILE)
        RandomAccessFile(lock, "rw").channel.use { channel ->
            val held = channel.tryLock() ?: run { progress.on("另一个更新任务正在进行"); return false }
            held.use {
                val manifest = fetchManifest()
                if (manifest.versionCode <= currentVersion()) {
                    progress.on("已是最新版本")
                    return false
                }
                val apk = prepare(manifest, progress)
                if (!context.packageManager.canRequestPackageInstalls()) {
                    progress.on("已下载 ${manifest.versionName}, 需要允许本应用安装未知应用, 允许后返回会自动继续")
                    InstallPermission.request(context)
                    return false
                }
                progress.on("正在安装 ${manifest.versionName}")
                install(apk)
                return true
            }
        }
    }

    private fun prepare(manifest: UpdateManifest, progress: Progress): File {
        val target = File(dir(), "$APK_PREFIX${manifest.versionCode}$APK_SUFFIX")
        if (target.exists() && sha256(target).equals(manifest.apk.sha256, ignoreCase = true)) {
            progress.on("复用已下载的安装包")
            return target
        }
        val base = File(context.applicationInfo.sourceDir)
        val patch = manifest.patches.firstOrNull { it.fromSha256 == sha256(base) }
        if (patch != null) {
            val ok = runCatching {
                progress.on("下载增量补丁 ${patch.file.size / KB} KB")
                val patchFile = fetchTo(patch.file, File(dir(), PATCH_FILE))
                BsPatch.apply(base, patchFile, target)
                patchFile.delete()
                verify(target, manifest.apk.sha256)
            }.isSuccess
            if (ok) return target
            progress.on("补丁失败, 改为完整下载")
        }
        progress.on("下载完整安装包 ${manifest.apk.size / KB} KB")
        return fetchTo(manifest.apk, target)
    }

    private fun install(apk: File) {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        params.setAppPackageName(context.packageName)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        }
        val sessionId = installer.createSession(params)
        installer.openSession(sessionId).use { session ->
            session.openWrite(SESSION_NAME, 0, apk.length()).use { out ->
                apk.inputStream().use { it.copyTo(out) }
                session.fsync(out)
            }
            val callback = PendingIntent.getBroadcast(
                context,
                sessionId,
                Intent(Constants.ACTION_INSTALL_RESULT).setPackage(context.packageName),
                PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            session.commit(callback.intentSender)
        }
    }

    private fun fetchTo(file: UpdateFile, target: File): File {
        Net.client(context).newCall(Request.Builder().url(file.url).build()).execute().use { resp ->
            if (!resp.isSuccessful) throw IOException("下载失败 ${resp.code}")
            target.outputStream().use { out -> resp.body!!.byteStream().copyTo(out) }
        }
        verify(target, file.sha256)
        return target
    }

    private fun download(url: String): ByteArray =
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
        private const val SESSION_NAME = "base.apk"
        private const val APK_PREFIX = "update-"
        private const val APK_SUFFIX = ".apk"
        private const val PATCH_FILE = "update.patch"
        private const val KB = 1024

        // 已下载但还没装上的版本, 回到前台时据此自动继续安装
        fun hasPending(context: Context): Boolean {
            val current = Updater(context).currentVersion()
            return cached(context).any { it.second > current }
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
                val buf = ByteArray(64 * 1024)
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
