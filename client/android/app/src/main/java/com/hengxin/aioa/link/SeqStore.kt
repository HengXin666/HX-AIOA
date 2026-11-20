package com.hengxin.aioa.link

import android.content.Context
import com.hengxin.aioa.Constants

// 只在 :link 进程内读写, 记录已收到的最大序号, 重连时用于补拉
class SeqStore(context: Context) {
    private val prefs = context.getSharedPreferences(Constants.PREFS_LINK, Context.MODE_PRIVATE)
    private var cached = prefs.getLong(Constants.KEY_LAST_SEQ, 0L)

    fun last(): Long = cached

    fun save(seq: Long) {
        if (seq <= cached) return
        cached = seq
        prefs.edit().putLong(Constants.KEY_LAST_SEQ, seq).apply()
    }
}
