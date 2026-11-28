package com.hengxin.aioa.update

/** 自动下载的网络条件: 仅 Wi-Fi (不计流量的网络) / 任意网络 / 关。 */
enum class AutoDownload(val key: String, val label: String) {
    WIFI("wifi", "仅 Wi-Fi"),
    ANY("any", "任意网络"),
    OFF("off", "关");

    companion object {
        fun of(key: String?): AutoDownload = entries.firstOrNull { it.key == key } ?: WIFI
    }
}

enum class NetKind { NONE, METERED, UNMETERED }

/** 自动更新的纯判断, 不碰 Android API, 便于单测。 */
object UpdatePolicy {
    const val TAG_PREFIX = "android-"

    /** release 标签 android-N 的 N 就是 versionCode (CI 用 run_number 同时生成两者)。 */
    fun tagVersion(tag: String?): Long? =
        tag?.takeIf { it.startsWith(TAG_PREFIX) }?.removePrefix(TAG_PREFIX)?.toLongOrNull()

    fun isNewer(remote: Long?, local: Long): Boolean = remote != null && remote > local

    /** 从没查过, 超过间隔, 或时钟被往回拨过, 都算到期。 */
    fun checkDue(now: Long, last: Long, interval: Long): Boolean = last <= 0 || now < last || now - last >= interval

    fun canDownload(mode: AutoDownload, net: NetKind): Boolean = when (mode) {
        AutoDownload.OFF -> false
        AutoDownload.ANY -> net != NetKind.NONE
        AutoDownload.WIFI -> net == NetKind.UNMETERED
    }
}
