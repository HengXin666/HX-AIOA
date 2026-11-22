package com.hengxin.aioa.link

import android.Manifest
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import androidx.annotation.ColorRes
import androidx.annotation.DrawableRes
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.graphics.drawable.toBitmap
import com.hengxin.aioa.Constants
import com.hengxin.aioa.R
import com.hengxin.aioa.config.JsonFile
import java.io.File

/** 通知的公共外观: 品牌色, App 大图标, 打开界面或链接, 分组摘要。不依赖 Compose, :link 进程可用。 */
object NotifyKit {

    // 外观设置文件与键名, 与 config/AppearanceStore 一致; 那边依赖 Compose, 这里只读原始 JSON
    private const val APPEARANCE_FILE = "appearance.json"
    private const val KEY_ACCENT = "accent"
    private const val UI_ACTIVITY = "com.hengxin.aioa.ui.MainActivity"

    @Volatile
    private var largeIcon: Bitmap? = null

    fun granted(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    /** 用户设置了主题色就跟随, 否则用品牌色。 */
    fun brandColor(context: Context): Int {
        val o = JsonFile.read(File(context.filesDir, APPEARANCE_FILE))
        if (o != null && o.has(KEY_ACCENT)) return o.optInt(KEY_ACCENT)
        return color(context, R.color.notify_brand)
    }

    fun color(context: Context, @ColorRes id: Int): Int = ContextCompat.getColor(context, id)

    // 大图标用应用插画的头像裁切 (res/drawable-nodpi/notify_large.webp); 整张自适应图标缩到 64dp 人物太小, 看不出来
    fun appIcon(context: Context): Bitmap? = largeIcon ?: runCatching {
        val size = context.resources.getDimensionPixelSize(android.R.dimen.notification_large_icon_width)
        ContextCompat.getDrawable(context, R.drawable.notify_large)?.toBitmap(size, size)
    }.getOrNull()?.also { largeIcon = it }

    fun builder(context: Context, channel: String, @DrawableRes icon: Int, withLarge: Boolean = true): NotificationCompat.Builder {
        val b = NotificationCompat.Builder(context, channel)
            .setSmallIcon(icon)
            .setColor(brandColor(context))
            .setShowWhen(true)
        if (withLarge) appIcon(context)?.let(b::setLargeIcon)
        return b
    }

    // 用类名启动界面, 避免 :link 进程加载 Activity 及 Compose 相关类
    fun openApp(context: Context): PendingIntent = PendingIntent.getActivity(
        context,
        0,
        Intent().setClassName(context, UI_ACTIVITY).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    /** 有链接就用浏览器打开, 没有或打不开就回到 App。 */
    fun openUrl(context: Context, url: String?): PendingIntent {
        val uri = url?.let { runCatching { Uri.parse(it) }.getOrNull() }?.takeIf { it.scheme?.startsWith("http") == true }
            ?: return openApp(context)
        val intent = Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return PendingIntent.getActivity(context, url.hashCode(), intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    fun post(context: Context, tag: String?, id: Int, notification: Notification) {
        if (!granted(context)) return
        runCatching { NotificationManagerCompat.from(context).notify(tag, id, notification) }
    }

    fun cancel(context: Context, tag: String?, id: Int) {
        NotificationManagerCompat.from(context).cancel(tag, id)
    }

    /** 组内子通知的数量 (不含摘要)。 */
    fun groupSize(context: Context, group: String, except: String? = null): Int =
        context.getSystemService(NotificationManager::class.java).activeNotifications.count {
            it.notification.group == group && it.notification.flags and Notification.FLAG_GROUP_SUMMARY == 0 && it.tag != except
        }

    /** 组摘要: 子通知只剩零条时撤掉, 否则刷新计数。摘要本身不响铃, 由子通知负责提醒。
     *  刚发出的子通知可能还没出现在 activeNotifications 里, 所以发完调用时 atLeast 取 1; 刚撤掉的用 except 排除。 */
    fun summary(context: Context, channel: String, @DrawableRes icon: Int, group: String, id: Int, title: String, atLeast: Int = 1, except: String? = null) {
        val n = maxOf(groupSize(context, group, except), atLeast)
        if (n == 0) {
            cancel(context, null, id)
            return
        }
        val notification = builder(context, channel, icon, withLarge = false)
            .setContentTitle(title)
            .setContentText(context.getString(R.string.notify_group_count, n))
            .setStyle(NotificationCompat.InboxStyle().setSummaryText(context.getString(R.string.notify_group_count, n)))
            .setGroup(group)
            .setGroupSummary(true)
            .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
            .setNumber(n)
            .setContentIntent(openApp(context))
            .setAutoCancel(true)
            .setSilent(true)
            .build()
        post(context, null, id, notification)
    }

    /** 看完消息时撤掉全部消息通知 (各来源的会话加上摘要)。 */
    fun clearMessages(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.activeNotifications.filter { it.id == Constants.NOTIFY_ID_MESSAGE }.forEach { manager.cancel(it.tag, it.id) }
    }
}
