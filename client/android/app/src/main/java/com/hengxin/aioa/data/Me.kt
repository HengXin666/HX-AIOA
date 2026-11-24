package com.hengxin.aioa.data

import android.content.Context

/** 当前账号 id 与昵称: 每次连上时由 welcome 带来并记下, 两个进程各自读写同一份; 用于认出自己发的消息和显示自己的名字。 */
object Me {
    private const val PREFS = "me"
    private const val K_UID = "uid"
    private const val K_NAME = "name"
    // 没有账号昵称时自己的显示名
    const val FALLBACK_NAME = "我"

    @Volatile
    var uid: String? = null
        private set

    @Volatile
    var name: String? = null
        private set

    val label: String get() = name ?: FALLBACK_NAME

    fun load(context: Context) {
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        uid = p.getString(K_UID, null)
        name = p.getString(K_NAME, null)
    }

    fun set(context: Context, value: String?, display: String? = null) {
        val nextName = display ?: name
        if ((value == null || value == uid) && nextName == name) return
        if (value != null) uid = value
        name = nextName
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(K_UID, uid).putString(K_NAME, name).apply()
    }
}
