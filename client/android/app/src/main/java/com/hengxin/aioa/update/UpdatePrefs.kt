package com.hengxin.aioa.update

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import org.json.JSONObject
import java.io.File

data class UpdateSettings(
    val autoCheck: Boolean = true,
    val autoDownload: AutoDownload = AutoDownload.WIFI,
    val lastCheck: Long = 0L,
    val etag: String = "",
    val latestTag: String = "",
)

// 存成 JSON 文件而不是 SharedPreferences: 界面进程写, :link 进程的维护也要读到最新值
object UpdatePrefs {
    private const val FILE = "update_prefs.json"
    private const val K_AUTO_CHECK = "autoCheck"
    private const val K_AUTO_DOWNLOAD = "autoDownload"
    private const val K_LAST_CHECK = "lastCheck"
    private const val K_ETAG = "etag"
    private const val K_TAG = "latestTag"

    @Synchronized
    fun load(context: Context): UpdateSettings = runCatching {
        val o = JSONObject(file(context).readText())
        UpdateSettings(
            o.optBoolean(K_AUTO_CHECK, true),
            AutoDownload.of(o.optString(K_AUTO_DOWNLOAD)),
            o.optLong(K_LAST_CHECK),
            o.optString(K_ETAG),
            o.optString(K_TAG),
        )
    }.getOrDefault(UpdateSettings())

    @Synchronized
    fun edit(context: Context, change: (UpdateSettings) -> UpdateSettings): UpdateSettings {
        val s = change(load(context))
        val o = JSONObject()
            .put(K_AUTO_CHECK, s.autoCheck)
            .put(K_AUTO_DOWNLOAD, s.autoDownload.key)
            .put(K_LAST_CHECK, s.lastCheck)
            .put(K_ETAG, s.etag)
            .put(K_TAG, s.latestTag)
        runCatching { file(context).writeText(o.toString()) }
        return s
    }

    fun net(context: Context): NetKind {
        val cm = context.getSystemService(ConnectivityManager::class.java) ?: return NetKind.NONE
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return NetKind.NONE
        if (!caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) return NetKind.NONE
        val free = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) || caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
        return if (free) NetKind.UNMETERED else NetKind.METERED
    }

    /** 后台 (维护) 检查更新也受这两个开关约束。 */
    fun allowsAuto(context: Context): Boolean {
        val s = load(context)
        return s.autoCheck && UpdatePolicy.canDownload(s.autoDownload, net(context))
    }

    private fun file(context: Context) = File(context.filesDir, FILE)
}
