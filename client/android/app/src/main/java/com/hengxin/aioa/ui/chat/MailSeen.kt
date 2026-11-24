package com.hengxin.aioa.ui.chat

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue

/**
 * 邮件已读: 水位线之前的都算已读, 之后的按打开过的 id 记。
 * 第一次用时水位线设为现在, 旧信不会一片未读。
 */
class MailSeen(context: Context) {
    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private var mark = prefs.getLong(KEY_MARK, 0L).takeIf { it > 0 } ?: System.currentTimeMillis().also { prefs.edit().putLong(KEY_MARK, it).apply() }
    private val ids = prefs.getStringSet(KEY_IDS, emptySet()).orEmpty().toMutableSet()
    // 手动标成未读的
    private val forced = prefs.getStringSet(KEY_FORCED, emptySet()).orEmpty().toMutableSet()
    // 界面靠它重组
    var version by mutableIntStateOf(0)
        private set

    fun unread(m: MailItem): Boolean = m.id in forced || (m.ts > mark && m.id !in ids)

    fun set(items: List<MailItem>, read: Boolean) {
        val keys = items.map { it.id }
        if (read) {
            forced.removeAll(keys.toSet())
            ids.addAll(items.filter { it.ts > mark }.map { it.id })
        } else {
            ids.removeAll(keys.toSet())
            forced.addAll(keys)
        }
        save()
    }

    fun allRead() {
        mark = System.currentTimeMillis()
        ids.clear()
        forced.clear()
        save()
    }

    private fun save() {
        // 只留最近的一批, 水位线之前的 id 没用了
        if (ids.size > MAX_IDS) ids.retainAll(ids.toList().takeLast(MAX_IDS).toSet())
        if (forced.size > MAX_IDS) forced.retainAll(forced.toList().takeLast(MAX_IDS).toSet())
        prefs.edit().putLong(KEY_MARK, mark).putStringSet(KEY_IDS, ids.toSet()).putStringSet(KEY_FORCED, forced.toSet()).apply()
        version++
    }

    private companion object {
        const val PREFS = "mail-seen"
        const val KEY_MARK = "mark"
        const val KEY_IDS = "ids"
        const val KEY_FORCED = "forced"
        const val MAX_IDS = 400
    }
}
