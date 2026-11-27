package com.hengxin.aioa.data

import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.os.Build

/** 系统记下的本 App 界面事件 (#142): RESUMED 进前台, PAUSED / STOPPED 离开; cls 区分同一 App 的不同界面。 */
data class UiEvent(val at: Long, val resumed: Boolean, val cls: String)

/**
 * 前台会话的第二个来源 (#142): UsageStatsManager.queryEventsForSelf (Android 9 起, 只查本 App, 不需要 PACKAGE_USAGE_STATS)。
 * 系统一直在记, 所以装上这一版之前几天的也能补上 (系统保留约一周多, 各厂商不同); 本机 UsageLog 只从这一版起有。
 */
object UsageEventsSource {
    fun sessions(context: Context, from: Long, to: Long): List<Session> {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return emptyList()
        val um = context.getSystemService(UsageStatsManager::class.java) ?: return emptyList()
        val list = ArrayList<UiEvent>()
        runCatching {
            val events = um.queryEventsForSelf(from, to) ?: return emptyList()
            val e = UsageEvents.Event()
            while (events.getNextEvent(e)) {
                when (e.eventType) {
                    RESUMED -> list.add(UiEvent(e.timeStamp, true, e.className.orEmpty()))
                    PAUSED, STOPPED -> list.add(UiEvent(e.timeStamp, false, e.className.orEmpty()))
                }
            }
        }
        return toSessions(list, to)
    }

    /** 任一界面处于 RESUMED 就算在前台; 到 to 还没离开的按 to 截止。 */
    fun toSessions(events: List<UiEvent>, to: Long): List<Session> {
        val open = HashSet<String>()
        val out = ArrayList<Session>()
        var start = 0L
        for (e in events.sortedBy { it.at }) {
            if (e.resumed) {
                if (open.isEmpty()) start = e.at
                open.add(e.cls)
            } else if (open.remove(e.cls) && open.isEmpty() && e.at > start) {
                out.add(Session(start, e.at))
            }
        }
        if (open.isNotEmpty() && to > start) out.add(Session(start, to))
        return out
    }

    // UsageEvents.Event 的取值: ACTIVITY_RESUMED = 1, ACTIVITY_PAUSED = 2, ACTIVITY_STOPPED = 23 (API 29)
    private const val RESUMED = 1
    private const val PAUSED = 2
    private const val STOPPED = 23
}
