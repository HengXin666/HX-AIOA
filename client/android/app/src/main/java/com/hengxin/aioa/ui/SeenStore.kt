package com.hengxin.aioa.ui

import android.content.Context
import androidx.compose.runtime.mutableStateMapOf

private const val PREFS = "overview_seen"
private const val KEEP = 400

/** 总览里看过或划掉的条目: 记 id 与时间, 只保留最近的若干条; 不写服务端, 每台设备各管各的。 */
class SeenStore(context: Context) {
    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val seen = mutableStateMapOf<String, Long>().apply {
        prefs.all.forEach { (k, v) -> (v as? Long)?.let { put(k, it) } }
    }

    fun has(id: String): Boolean = seen.containsKey(id)

    fun mark(ids: Collection<String>) {
        if (ids.isEmpty()) return
        val now = System.currentTimeMillis()
        val e = prefs.edit()
        ids.forEach { seen[it] = now; e.putLong(it, now) }
        // 超出上限时丢掉最早的
        if (seen.size > KEEP) seen.entries.sortedBy { it.value }.take(seen.size - KEEP).map { it.key }.forEach { seen.remove(it); e.remove(it) }
        e.apply()
    }
}
