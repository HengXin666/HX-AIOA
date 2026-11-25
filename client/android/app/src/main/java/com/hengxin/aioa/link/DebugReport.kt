package com.hengxin.aioa.link

import android.content.Context
import java.io.File

// 调试模式: 开关存成一个标记文件, 两个进程都能直接读; 统计全部从已有日志现算, 不额外唤醒
object DebugReport {
    private const val FLAG_FILE = "debug_mode"
    const val FG = "[App 前台]"
    const val BG = "[App 后台]"
    const val UI_PREFIX = "[界面]"
    private const val CONNECTED = "已连接"
    private const val CONNECTING = "开始连接"

    fun enabled(context: Context): Boolean = flag(context).exists()

    fun setEnabled(context: Context, on: Boolean) {
        runCatching { if (on) flag(context).writeText("1") else flag(context).delete() }
    }

    /** 今天 (本机时间) 的建连统计: 后台连接与界面连接分开, 后台连接再分 App 是否打开。 */
    fun today(context: Context): List<String> {
        val day = LinkLog.clock(System.currentTimeMillis()).take(DAY_LEN)
        val lines = LinkLog.recent(context, LinkLog.KEEP_LINES).filter { it.startsWith(day) }
        val ui = lines.filter { it.contains(UI_PREFIX) }
        val link = lines.filterNot { it.contains(UI_PREFIX) }
        val linkOk = link.filter { it.contains(CONNECTED) }
        return listOf(
            "后台连接: 尝试 ${link.count { it.contains(CONNECTING) }} 次, 连上 ${linkOk.size} 次 (App 打开时 ${linkOk.count { it.contains(FG) }} 次, 未打开时 ${linkOk.count { it.contains(BG) }} 次)",
            "界面连接: 尝试 ${ui.count { it.contains(CONNECTING) }} 次, 连上 ${ui.count { it.contains(CONNECTED) }} 次",
            "每次建连 = 1 次 Worker 请求 + 1 次 DO 请求",
        )
    }

    private const val DAY_LEN = 5

    private fun flag(context: Context) = File(context.filesDir, FLAG_FILE)
}
