package com.hengxin.aioa.data

import android.content.Context
import java.io.File

// 崩溃时把堆栈写到本地, 下次连上服务端后作为备忘发出去, 方便排查
object CrashLog {
    private const val FILE = "last-crash.txt"
    private const val MAX_CHARS = 3000

    fun install(context: Context) {
        val app = context.applicationContext
        val prev = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { t, e ->
            runCatching { File(app.filesDir, FILE).writeText("${t.name}\n${e.stackTraceToString()}".take(MAX_CHARS)) }
            prev?.uncaughtException(t, e)
        }
    }

    /** 取出并删除上次的崩溃记录。 */
    fun take(context: Context): String? {
        val f = File(context.filesDir, FILE)
        if (!f.exists()) return null
        return runCatching { f.readText() }.getOrNull().also { f.delete() }
    }
}
