package com.hengxin.aioa.link

import android.content.Context
import android.content.Intent
import androidx.core.app.Person
import androidx.core.content.LocusIdCompat
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import com.hengxin.aioa.Constants

/**
 * 会话快捷方式 (#151): 长期快捷方式加 LocusId, 消息通知挂上它, Android 11+ 才会放进 "对话" 区, 可设为优先对话。
 * 每个群一个, 点开进这个群; 标题或头像没变就不重推, 系统会按排名淘汰多出来的。
 */
object Conversations {
    private const val PREFIX = "conv:"
    private val pushed = HashMap<String, String>()

    fun id(key: String) = PREFIX + key

    fun locus(key: String) = LocusIdCompat(id(key))

    /** 推送失败 (系统限流等) 返回 false, 通知就不挂快捷方式, 照常显示。 */
    fun push(context: Context, key: String, title: String, icon: IconCompat, sign: String, person: Person?): Boolean {
        val id = id(key)
        if (pushed[id] == sign) return true
        val intent = Intent(Intent.ACTION_VIEW).setClassName(context, NotifyKit.UI_ACTIVITY)
            .putExtra(Constants.EXTRA_OPEN_GROUP, key)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val info = ShortcutInfoCompat.Builder(context, id)
            .setShortLabel(title)
            .setLongLabel(title)
            .setIcon(icon)
            .setIntent(intent)
            .setLongLived(true)
            .setLocusId(locus(key))
            .apply { person?.let { setPerson(it) } }
            .build()
        val ok = runCatching { ShortcutManagerCompat.pushDynamicShortcut(context, info) }.isSuccess
        if (ok) pushed[id] = sign
        return ok
    }
}
