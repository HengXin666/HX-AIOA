package com.hengxin.aioa.link

import android.Manifest
import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.content.ContextCompat
import com.hengxin.aioa.Constants
import com.hengxin.aioa.R
import com.hengxin.aioa.proto.ServerFrame

class Notifier(private val context: Context) {

    // 用类名启动界面, 避免 :link 进程加载 Activity 及 Compose 相关类
    private val openApp: PendingIntent = PendingIntent.getActivity(
        context,
        0,
        Intent().setClassName(context, UI_ACTIVITY)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    private val me = Person.Builder().setName(context.getString(R.string.me)).build()

    fun linkNotification(): Notification =
        NotificationCompat.Builder(context, Constants.CHANNEL_LINK)
            .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
            .setContentTitle(context.getString(R.string.link_running))
            .setContentIntent(openApp)
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .build()

    // 聚合全部未读, 每条新消息都重新提醒一次: 横幅, 震动, 锁屏可见
    fun showUnread(unread: List<ServerFrame.Msg>, total: Long) {
        if (unread.isEmpty()) return
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        if (!granted) return
        val style = NotificationCompat.MessagingStyle(me)
        unread.forEach { msg ->
            style.addMessage(msg.text, msg.ts, Person.Builder().setName(msg.src).setKey(msg.src).build())
        }
        val last = unread.last()
        val notification = NotificationCompat.Builder(context, Constants.CHANNEL_MESSAGE)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle(context.getString(R.string.unread_title, total))
            .setContentText(last.text)
            .setStyle(style)
            .setNumber(total.toInt())
            .setContentIntent(openApp)
            .setAutoCancel(true)
            .setWhen(last.ts)
            .setShowWhen(true)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setDefaults(NotificationCompat.DEFAULT_SOUND or NotificationCompat.DEFAULT_LIGHTS)
            .setVibrate(Constants.VIBRATE_PATTERN)
            .build()
        NotificationManagerCompat.from(context).notify(Constants.NOTIFY_ID_MESSAGE, notification)
    }

    private companion object {
        const val UI_ACTIVITY = "com.hengxin.aioa.ui.MainActivity"
    }
}
