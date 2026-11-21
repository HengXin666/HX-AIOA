package com.hengxin.aioa.link

import android.content.Context
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// 长连接事件日志: :link 进程写, 设置页读, 用来事后排查后台断线 (何时断, 为何断, 有没有重连)
object LinkLog {
    private const val FILE_NAME = "link_log.txt"
    private const val KEEP_LINES = 200
    private const val TRIM_AT_LINES = 400
    private const val CLOCK_PATTERN = "MM-dd HH:mm:ss"
    private val lock = Any()

    fun add(context: Context, event: String) {
        synchronized(lock) {
            runCatching {
                val file = file(context)
                file.appendText("${clock(System.currentTimeMillis())} $event\n")
                val lines = file.readLines()
                if (lines.size > TRIM_AT_LINES) file.writeText(lines.takeLast(KEEP_LINES).joinToString("\n", postfix = "\n"))
            }
        }
    }

    // 最新的在前
    fun recent(context: Context, max: Int): List<String> = runCatching {
        file(context).readLines().takeLast(max).reversed()
    }.getOrDefault(emptyList())

    fun clock(at: Long): String = SimpleDateFormat(CLOCK_PATTERN, Locale.US).format(Date(at))

    private fun file(context: Context) = File(context.filesDir, FILE_NAME)
}
