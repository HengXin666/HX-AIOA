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
    const val CONNECT_STALL_MS = 20_000L
    const val PROBE_TIMEOUT_MS = 5000L
    const val WATCHDOG_INTERVAL_MS = 5 * 60_000L
    const val WATCHDOG_WAKE_MS = 10_000L

    // 渠道 id 一旦创建, 重要性等设置就由用户掌控, 改设置只能换新 id
    const val CHANNEL_LINK = "link"
    const val CHANNEL_MESSAGE = "message_v2"
    const val CHANNEL_MESSAGE_LEGACY = "message"
    const val CHANNEL_UPDATE = "update"
    const val NOTIFY_ID_LINK = 1
    const val NOTIFY_ID_MESSAGE = 2
    const val NOTIFY_ID_UPDATE = 3
    val VIBRATE_PATTERN = longArrayOf(0, 250, 150, 250)

    const val HISTORY_PAGE = 300
    const val NOTIFY_MAX_LINES = 6
    const val TIME_GAP_MS = 5 * 60_000L

    const val PROXY_PORT = 17890
    const val PROXY_CONTROLLER_PORT = 17891
    const val PROXY_GROUP = "PROXY"
    const val PROXY_TEST_URL = "https://www.gstatic.com/generate_204"
    const val PROXY_TEST_TIMEOUT_MS = 3000
    const val PROXY_OPTIMIZE_INTERVAL_MS = 60 * 60_000L
    const val PROXY_OPTIMIZE_DEBOUNCE_MS = 10_000L
    const val PROXY_READY_TIMEOUT_MS = 5000L
    const val PROXY_PROBE_TIMEOUT_MS = 100
    const val LOOPBACK = "127.0.0.1"

    const val UPDATE_MANIFEST_URL = "https://github.com/HengXin666/HX-AIOA/releases/latest/download/update.json"
    const val UPDATE_INTERVAL_MS = 6 * 60 * 60_000L
    const val UPDATE_DIR = "update"

    const val ACTION_RELOAD = "com.hengxin.aioa.RELOAD"
    const val ACTION_OPTIMIZE = "com.hengxin.aioa.OPTIMIZE"
    const val ACTION_WATCHDOG = "com.hengxin.aioa.WATCHDOG"
    const val ACTION_INSTALL_RESULT = "com.hengxin.aioa.INSTALL_RESULT"
}
