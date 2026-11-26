package com.hengxin.aioa

object Constants {
    const val WS_PATH = "ws"
    const val STREAM_PATH = "api/v1/stream"
    const val QUERY_ROLE = "role"
    const val ROLE_CLIENT = "client"
    const val QUERY_TOKEN = "token"
    const val QUERY_DEVICE = "device"
    const val QUERY_SINCE = "since"
    // 握手: 带上 App 按哪个协议大版本写的, 服务端在 welcome 里给出兼容档位
    const val QUERY_PROTOCOL = "pv"
    const val PROTOCOL_VERSION = 2

    const val DEVICE_PREFIX = "android"
    // 点通知打开对应的群
    const val EXTRA_OPEN_GROUP = "open_group"
    // 人发的消息的来源类型 (与 protocol SOURCE_TYPE_USER 一致)
    const val SOURCE_TYPE_USER = "user"
    const val DEVICE_LINK = "link"
    const val DEVICE_UI = "ui"

    // :link 的心跳只由看门狗闹钟发文本 ping (服务端自动回 pong, 不唤醒 DO), OkHttp 协议 ping 关闭, 避免双重心跳
    const val LINK_PING_INTERVAL_SEC = 0L
    // 界面进程只在前台连接, 短心跳便于尽快发现断线, 不影响后台耗电
    const val UI_PING_INTERVAL_SEC = 30L
    // 界面连接连续这么多个心跳间隔收不到任何数据才重连
    const val UI_DEAD_INTERVALS = 3
    // 界面切到后台后, 界面连接再保留多久才断开
    const val UI_LINGER_MS = 90_000L
    const val RECONNECT_MIN_MS = 500L
    const val RECONNECT_MAX_MS = 30_000L
    const val NORMAL_CLOSE = 1000
    const val CONNECT_STALL_MS = 20_000L
    const val PROBE_TIMEOUT_MS = 5000L
    // 自适应心跳: 从保守值起步, 探测成功就拉长, 探测到连接已死就退回上一个可用值并固定; 上限接近 Doze 闹钟最短间隔的整数倍
    const val HEARTBEAT_MIN_MS = 4 * 60_000L
    const val HEARTBEAT_MAX_MS = 14 * 60_000L
    const val HEARTBEAT_STEP_MS = 2 * 60_000L
    // 唤醒锁上限: 覆盖一次探测超时加一次重连; 收到 pong 或有流量免探测时立即释放
    const val WATCHDOG_WAKE_MS = PROBE_TIMEOUT_MS + CONNECT_STALL_MS / 2
    const val MAINTENANCE_WAKE_MS = 60_000L

    // 渠道 id 一旦创建, 重要性等设置就由用户掌控, 改设置只能换新 id
    const val CHANNEL_LINK = "link_v2"
    const val CHANNEL_LINK_LEGACY = "link"
    const val CHANNEL_MESSAGE = "message_v2"
    const val CHANNEL_MESSAGE_LEGACY = "message"
    const val CHANNEL_UPDATE = "update"
    const val CHANNEL_ALERT = "alert"
    const val CHANNEL_AGENT = "agent"
    const val CHANNEL_GITHUB = "github"
    const val CHANNEL_REPORT = "report"
    // 同一类通知共用一个 id, 用 tag 区分来源或去重键, 不会撞号
    const val NOTIFY_ID_LINK = 1
    const val NOTIFY_ID_MESSAGE = 2
    const val NOTIFY_ID_UPDATE = 3
    const val NOTIFY_ID_ALERT = 4
    const val NOTIFY_ID_AGENT = 5
    const val NOTIFY_ID_EVENT = 6
    const val NOTIFY_ID_TRANSFER = 7
    const val GROUP_MESSAGE = "com.hengxin.aioa.group.MESSAGE"
    const val GROUP_ALERT = "com.hengxin.aioa.group.ALERT"
    const val GROUP_AGENT = "com.hengxin.aioa.group.AGENT"
    const val GROUP_EVENT = "com.hengxin.aioa.group.EVENT"
    val VIBRATE_PATTERN = longArrayOf(0, 250, 150, 250)

    const val HISTORY_PAGE = 300
    // 与 protocol TYPING_THROTTLE_MS 一致: 输入期间最多每 4 秒报一次 "正在输入"
    const val TYPING_THROTTLE_MS = 4000L
    const val NOTIFY_MAX_LINES = 6
    const val TIME_GAP_MS = 5 * 60_000L

    const val PROXY_PORT = 17890
    const val PROXY_CONTROLLER_PORT = 17891
    const val PROXY_GROUP = "PROXY"
    const val PROXY_TEST_URL = "https://www.gstatic.com/generate_204"
    const val PROXY_TEST_TIMEOUT_MS = 3000
    // 内核按需启动: 最后一次使用后空闲这么久就停掉 (长连接走代理时常驻)
    const val PROXY_IDLE_STOP_MS = 5 * 60_000L
    // 内核仍在跑时, 距上次测速超过这么久才在下一次按需使用时重测
    const val PROXY_OPTIMIZE_MAX_AGE_MS = 6 * 60 * 60_000L
    const val PROXY_OPTIMIZE_DEBOUNCE_MS = 10_000L
    const val PROXY_READY_TIMEOUT_MS = 5000L
    const val PROXY_PROBE_TIMEOUT_MS = 100
    const val LOOPBACK = "127.0.0.1"

    const val UPDATE_MANIFEST_URL = "https://github.com/HengXin666/HX-AIOA/releases/latest/download/update.json"
    // 更新检查与订阅刷新合并为一次维护, 搭看门狗或亮屏的唤醒执行, 不单独设闹钟
    const val UPDATE_INTERVAL_MS = 6 * 60 * 60_000L
    const val MAINTENANCE_FIRST_DELAY_MS = 60_000L
    const val UPDATE_DIR = "update"

    // 协议 v1 词汇, 与 protocol/src/v1/constants.ts 一致
    const val PRIORITY_NEED_ME = "need_me"
    const val PRIORITY_HAPPENING = "happening"
    const val PRIORITY_WORTH_READING = "worth_reading"
    const val KIND_EVENT = "event"
    const val KIND_METRIC = "metric"
    const val KIND_TASK = "task"
    const val KIND_REPORT = "report"
    const val TASK_RUNNING = "running"
    const val TASK_WAITING = "waiting"
    const val TASK_DONE = "done"
    const val TASK_FAILED = "failed"
    const val TASK_CANCELLED = "cancelled"
    const val SEVERITY_CRITICAL = "critical"
    const val SEVERITY_WARNING = "warning"
    const val ACT_APPROVE = "approve"
    const val ACT_REJECT = "reject"
    const val ACT_REPLY = "reply"
    const val ACT_ASK = "ask"
    const val SPACES_PATH = "api/v1/spaces"
    const val TASKS_PATH = "api/v1/tasks"
    const val SOURCES_PATH = "api/v1/sources"
    const val SOURCE_TYPES_PATH = "api/v1/source-types"
    const val EVENTS_PATH = "api/v1/events"
    const val KEYS_PATH = "api/v1/keys"
    const val CHATS_API = "api/v1/chats"
    // 插件数据 pdata 与待办插件 (#101): 待办存在 hengxin666.todo 的 items 集合, 与 protocol/src/v1/plugin-todo.ts 一致
    const val PDATA_API = "api/v1/pdata"
    const val TODO_PLUGIN = "hengxin666.todo"
    const val TODO_COLL = "items"
    // 群邀请链接: hxaioa://join?server=..&code=.., 与服务端 APP_SCHEME 一致
    const val APP_SCHEME = "hxaioa"
    const val JOIN_HOST = "join"
    const val QUERY_CODE = "code"
    const val QUERY_SERVER = "server"
    const val QUERY_KEY = "key"
    const val SOURCE_GITHUB = "github"
    const val SOURCE_AGENT = "agent"
    // GitHub 接入是插件: 主人停用后 github 接口 404, 入口隐藏
    const val GITHUB_PLUGIN = "hengxin666.github"
    const val GITHUB_REPOS_PATH = "api/v1/github/repos"
    const val GITHUB_SYNC_PATH = "api/v1/github/sync"
    const val GITHUB_AVAILABLE_PATH = "api/v1/github/available"
    const val GITHUB_TRACKED_PATH = "api/v1/github/tracked"
    const val GITHUB_ACTIVITY_PATH = "api/v1/github/activity"
    const val GITHUB_DAILY_PATH = "api/v1/github/daily"
    const val GITHUB_BRANCHES_PATH = "api/v1/github/branches"
    const val AUTH_LOGIN_PATH = "api/v1/auth/login"
    const val AUTH_REFRESH_PATH = "api/v1/auth/refresh"
    const val AUTH_LOGOUT_PATH = "api/v1/auth/logout"
    const val ME_PATH = "api/v1/me"
    const val ME_DEVICES_PATH = "api/v1/me/devices"
    const val ME_PASSWORD_PATH = "api/v1/me/password"
    const val JOIN_PATH = "api/v1/join"
    const val USERS_PATH = "api/v1/users"
    const val INVITES_PATH = "api/v1/invites"
    const val SETTINGS_PATH = "api/v1/settings"
    // 消息分组 (群放进组) 存在账号设置里, 多端同步
    const val SETTING_CHAT_FOLDERS = "chatFolders"
    // 工作台按钮动作的 taskId 前缀, 与 protocol 的 BUTTON_TASK_PREFIX 一致
    const val BUTTON_TASK_PREFIX = "button:"
    const val STYLE_DANGER = "danger"
    const val STYLE_PRIMARY = "primary"
    const val ICON_ACTIVITY = "activity"
    // 这些路由动作只更新界面, 不弹通知
    val QUIET_ROUTES = setOf("silent", "digest", "aggregate", "drop")

    const val ACTION_RELOAD = "com.hengxin.aioa.RELOAD"
    // ACTION_RELOAD 的附加参数: 订阅地址变了才重新下载并重启内核
    const val EXTRA_FRESH = "fresh"
    const val ACTION_OPTIMIZE = "com.hengxin.aioa.OPTIMIZE"
    const val ACTION_WATCHDOG = "com.hengxin.aioa.WATCHDOG"
    const val ACTION_PROXY_DEMAND = "com.hengxin.aioa.PROXY_DEMAND"
    const val ACTION_INSTALL_RESULT = "com.hengxin.aioa.INSTALL_RESULT"
    const val ACTION_AGENT_ACT = "com.hengxin.aioa.AGENT_ACT"
}
