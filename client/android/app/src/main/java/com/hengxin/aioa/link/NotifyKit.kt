package com.hengxin.aioa.link

import com.hengxin.aioa.browser.Browser
import android.Manifest
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.annotation.ColorRes
import androidx.annotation.DrawableRes
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.hengxin.aioa.Constants
import com.hengxin.aioa.R
import com.hengxin.aioa.config.JsonFile
import java.io.File

/** 通知的公共外观: 品牌色, 打开界面或链接, 分组摘要。不依赖 Compose, :link 进程可用。 */
object NotifyKit {

    // 外观设置文件与键名, 与 config/AppearanceStore 一致; 那边依赖 Compose, 这里只读原始 JSON
    private const val APPEARANCE_FILE = "appearance.json"
    private const val KEY_ACCENT = "accent"
    private const val UI_ACTIVITY = "com.hengxin.aioa.ui.MainActivity"
    private const val SUMMARY_LINES = 5

    fun granted(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    /** 用户设置了主题色就跟随, 否则用品牌色。 */
    fun brandColor(context: Context): Int {
        val o = JsonFile.read(File(context.filesDir, APPEARANCE_FILE))
        if (o != null && o.has(KEY_ACCENT)) return o.optInt(KEY_ACCENT)
        return color(context, R.color.notify_brand)
    }

    fun color(context: Context, @ColorRes id: Int): Int = ContextCompat.getColor(context, id)

    // 不设大图标: 系统已在左上角显示 App 图标, 再放一张大图只会挤占正文
    fun builder(context: Context, channel: String, @DrawableRes icon: Int): NotificationCompat.Builder =
        NotificationCompat.Builder(context, channel)
            .setSmallIcon(icon)
            .setColor(brandColor(context))
            .setShowWhen(true)

    // 用类名启动界面, 避免 :link 进程加载 Activity 及 Compose 相关类
    fun openApp(context: Context): PendingIntent = PendingIntent.getActivity(
        context,
        0,
        Intent().setClassName(context, UI_ACTIVITY).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    /** 点消息通知: 打开 App 并进到这个群 (进群即标已读); 每个群一个 PendingIntent。 */
    fun openGroup(context: Context, key: String): PendingIntent = PendingIntent.getActivity(
        context,
        key.hashCode(),
        Intent().setClassName(context, UI_ACTIVITY).putExtra(Constants.EXTRA_OPEN_GROUP, key)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    /** 有链接就在内置浏览器打开, 没有或不是网页就回到 App。 */
    fun openUrl(context: Context, url: String?): PendingIntent {
        val uri = url?.let { runCatching { Uri.parse(it) }.getOrNull() }?.takeIf(Browser::isWeb) ?: return openApp(context)
        val intent = Browser.intent(context, uri.toString())
        return PendingIntent.getActivity(context, url.hashCode(), intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    fun post(context: Context, tag: String?, id: Int, notification: Notification) {
        if (!granted(context)) return
        runCatching { NotificationManagerCompat.from(context).notify(tag, id, notification) }
            // 周报 (#140): 数发出的通知; 传输与更新的进度通知会反复刷新, 不算
            .onSuccess { if (id != Constants.NOTIFY_ID_TRANSFER && id != Constants.NOTIFY_ID_UPDATE) com.hengxin.aioa.data.LocalTally.add(com.hengxin.aioa.data.Tally.NOTIFY) }
    }

    fun active(context: Context, tag: String, id: Int): Boolean =
        context.getSystemService(NotificationManager::class.java).activeNotifications.any { it.tag == tag && it.id == id }

    fun cancel(context: Context, tag: String?, id: Int) {
        NotificationManagerCompat.from(context).cancel(tag, id)
    }

    /** 组摘要: 子通知只剩零条时撤掉, 否则刷新计数。摘要本身不响铃, 由子通知负责提醒。
     *  刚发出的子通知可能还没出现在 activeNotifications 里, 所以发完调用时 atLeast 取 1; 刚撤掉的用 except 排除。 */
    fun summary(context: Context, channel: String, @DrawableRes icon: Int, group: String, id: Int, title: String, atLeast: Int = 1, except: String? = null, latest: Pair<String, String>? = null) {
        // 刚发出的子通知可能还不在 activeNotifications 里, 用 latest (tag 与预览) 补上
        val children = (listOfNotNull(latest) + children(context, group, except)).distinctBy { it.first }.map { it.second }
        val n = maxOf(children.size, atLeast)
        if (n == 0) {
            cancel(context, null, id)
            return
        }
        val count = context.getString(R.string.notify_group_count, n)
        // 折叠时摘要自己就列出各条标题, 不必展开也能看; 不设点击动作, 有的系统点摘要会直接进 App 而不是展开
        val inbox = NotificationCompat.InboxStyle().setBigContentTitle(title).setSummaryText(count)
        children.take(SUMMARY_LINES).forEach { inbox.addLine(it) }
        val notification = builder(context, channel, icon)
            .setContentTitle(title)
            .setContentText(children.firstOrNull() ?: count)
            .setStyle(inbox)
            .setGroup(group)
            .setGroupSummary(true)
            .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
            .setNumber(n)
            .setSilent(true)
            .build()
        post(context, null, id, notification)
    }

    // 组内子通知的一行预览 (标题: 正文), 新的在前
    private fun children(context: Context, group: String, except: String?): List<Pair<String, String>> =
        context.getSystemService(NotificationManager::class.java).activeNotifications
            .filter { it.notification.group == group && it.notification.flags and Notification.FLAG_GROUP_SUMMARY == 0 && it.tag != except }
            .sortedByDescending { it.notification.`when` }
            .map { sbn ->
                val e = sbn.notification.extras
                val t = e.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
                val x = e.getCharSequence(Notification.EXTRA_TEXT)?.toString().orEmpty()
                sbn.tag.orEmpty() to line(t, x)
            }

    fun line(title: CharSequence?, text: CharSequence?): String = listOf(title, text).filter { !it.isNullOrBlank() }.joinToString(": ")

    /** 看完消息时撤掉全部消息通知 (各来源的会话加上摘要)。 */
    fun clearMessages(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.activeNotifications.filter { it.id == Constants.NOTIFY_ID_MESSAGE }.forEach { manager.cancel(it.tag, it.id) }
    }
}
