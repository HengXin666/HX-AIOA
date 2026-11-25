package com.hengxin.aioa.link

import android.content.Context
import com.hengxin.aioa.config.JsonFile
import org.json.JSONObject
import java.io.File
import java.util.concurrent.atomic.AtomicIntegerArray

// 连接与唤醒计数: 内存累加, 搭已有的唤醒顺带落盘, 用来和 batterystats 的唤醒次数对照, 本身不制造唤醒
object LinkStats {
    enum class Key(val label: String) {
        CONNECT("建连"),
        DISCONNECT("断线"),
        ALARM("闹钟唤醒"),
        SCREEN("亮屏检查"),
        NETWORK("网络变化"),
        PROBE("心跳探测"),
        PROBE_SKIP("有流量免探测"),
        PROBE_DEAD("探测判死"),
        MAINTENANCE("维护"),
        CORE_START("内核启动"),
        CORE_STOP("内核停止"),
        OPTIMIZE("节点测速"),
        RX("后台收帧"),
        RX_UNUSED("其中后台用不到的帧"),
    }

    private const val FILE_NAME = "link_stats.json"
    private const val KEY_SINCE = "since"
    private val counts = AtomicIntegerArray(Key.entries.size)

    @Volatile
    private var since = 0L

    @Volatile
    private var loaded = false

    fun hit(key: Key) {
        counts.incrementAndGet(key.ordinal)
    }

    // :link 启动时接上次的累计值, 进程被杀也不丢数
    fun load(context: Context) {
        if (loaded) return
        loaded = true
        val json = JsonFile.read(file(context))
        since = json?.optLong(KEY_SINCE)?.takeIf { it > 0 } ?: System.currentTimeMillis()
        Key.entries.forEach { counts.addAndGet(it.ordinal, json?.optInt(it.name) ?: 0) }
    }

    fun flush(context: Context) {
        if (!loaded) return
        val json = JSONObject().put(KEY_SINCE, since)
        Key.entries.forEach { json.put(it.name, counts.get(it.ordinal)) }
        runCatching { JsonFile.write(file(context), json) }
    }

    fun reset(context: Context) {
        Key.entries.forEach { counts.set(it.ordinal, 0) }
        since = System.currentTimeMillis()
        loaded = true
        flush(context)
    }

    /** 设置页展示用, 读的是 :link 最近一次落盘的值。 */
    fun summary(context: Context): String? {
        val json = JsonFile.read(file(context)) ?: return null
        val parts = Key.entries.map { "${it.label} ${json.optInt(it.name)}" }
        return "自 ${LinkLog.clock(json.optLong(KEY_SINCE))} 起: " + parts.joinToString(", ")
    }

    private fun file(context: Context) = File(context.filesDir, FILE_NAME)
}
