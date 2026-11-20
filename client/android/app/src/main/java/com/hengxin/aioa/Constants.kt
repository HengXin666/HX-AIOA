package com.hengxin.aioa

object Constants {
    const val WS_PATH = "ws"
    const val QUERY_TOKEN = "token"
    const val QUERY_DEVICE = "device"
    const val QUERY_SINCE = "since"

    const val DEVICE_PREFIX = "android"
    const val DEVICE_LINK = "link"
    const val DEVICE_UI = "ui"

    const val PING_INTERVAL_SEC = 60L
    const val RECONNECT_MIN_MS = 500L
    const val RECONNECT_MAX_MS = 30_000L
    const val NORMAL_CLOSE = 1000

    const val CHANNEL_LINK = "link"
    const val CHANNEL_MESSAGE = "message"
    const val NOTIFY_ID_LINK = 1
    const val NOTIFY_ID_MESSAGE = 2

    const val PREFS_LINK = "link"
    const val KEY_LAST_SEQ = "lastSeq"
}
