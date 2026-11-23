package com.hengxin.aioa.data

import android.content.Context

/** 当前账号 id: 每次连上时由 welcome 带来并记下, 两个进程各自读写同一份; 用于认出自己发的消息。 */
object Me {
    private const val PREFS = "me"
    private const val K_UID = "uid"

    @Volatile
    var uid: String? = null
        private set

    fun load(context: Context) {
        uid = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(K_UID, null)
    }

    fun set(context: Context, value: String?) {
        if (value == null || value == uid) return
        uid = value
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(K_UID, value).apply()
    }
}
