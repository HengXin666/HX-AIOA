package com.hengxin.aioa.data

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** 当前账号 id 与昵称: 每次连上时由 welcome 带来并记下, 两个进程各自读写同一份; 用于认出自己发的消息和显示自己的名字。 */
object Me {
    private const val PREFS = "me"
    private const val K_UID = "uid"
    private const val K_NAME = "name"
    private const val K_AVATAR = "avatar"
    private const val K_OLD_AVATAR = "settingsAvatar"
    // 没有账号昵称时自己的显示名
    const val FALLBACK_NAME = "我"

    @Volatile
    var uid: String? = null
        private set

    @Volatile
    var name: String? = null
        private set

    val label: String get() = name ?: FALLBACK_NAME

    /** 自己的头像 id (侧栏账号头用, #139); 账号页拉到或换了头像时记下。 */
    @Volatile
    var avatar: String? = null
        private set

    /** 旧版只存在账号设置 avatar 里的头像 (#142): 账号上 (user.avatar) 没有时侧栏用它兜底。 */
    @Volatile
    var settingsAvatar: String? = null
        private set

    private val _face = MutableStateFlow<String?>(null)

    /** 侧栏账号头显示的头像 id: 账号上的, 没有就用旧设置里的; 都没有为 null (用文字头像)。 */
    val face: StateFlow<String?> = _face

    private fun refresh() {
        _face.value = avatar ?: settingsAvatar
    }

    /** 账号上的头像 (welcome 帧的 user.avatar, 账号页, 换头像时); null 表示账号上没有。 */
    fun setAvatar(context: Context, id: String?) {
        if (id == avatar) return
        avatar = id
        refresh()
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(K_AVATAR, id).apply()
    }

    /** 账号设置里的旧头像字段 (随设置拉取与 settings 帧来, 不多发请求)。 */
    fun setSettingsAvatar(context: Context, id: String?) {
        if (id == settingsAvatar) return
        settingsAvatar = id
        refresh()
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(K_OLD_AVATAR, id).apply()
    }

    fun load(context: Context) {
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        uid = p.getString(K_UID, null)
        name = p.getString(K_NAME, null)
        avatar = p.getString(K_AVATAR, null)
        settingsAvatar = p.getString(K_OLD_AVATAR, null)
        refresh()
    }

    fun set(context: Context, value: String?, display: String? = null) {
        val nextName = display ?: name
        if ((value == null || value == uid) && nextName == name) return
        if (value != null) uid = value
        name = nextName
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(K_UID, uid).putString(K_NAME, name).apply()
    }
}
