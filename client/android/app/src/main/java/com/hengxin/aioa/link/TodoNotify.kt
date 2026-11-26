package com.hengxin.aioa.link

import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import com.hengxin.aioa.Constants
import com.hengxin.aioa.R

/** 待办提醒的通知: 本地闹钟和服务端推送都用这里, tag 是提醒的 key; 设了闹钟的用闹钟渠道循环响铃, 直到点 "停止" 或点开。 */
object TodoNotify {
    fun post(context: Context, p: TodoAlarmPlan) {
        val stop = PendingIntent.getBroadcast(
            context,
            0,
            Intent(context, TodoAlarmReceiver::class.java).setAction(TodoAlarms.ACTION_STOP).setData(android.net.Uri.parse("aioa-todo-stop:${android.net.Uri.encode(p.key)}")).putExtra(TodoAlarms.EXTRA_KEY, p.key),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val open = NotifyKit.openGroup(context, p.channel)
        val b = NotifyKit.builder(context, if (p.alarm) Constants.CHANNEL_TODO_ALARM else Constants.CHANNEL_TODO, R.drawable.ic_stat_alert)
            .setContentTitle(p.title)
            .setContentText(p.text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(p.text))
            .setContentIntent(open)
            .setWhen(if (p.at > 0) p.at else System.currentTimeMillis())
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(if (p.alarm) NotificationCompat.CATEGORY_ALARM else NotificationCompat.CATEGORY_REMINDER)
            .addAction(0, context.getString(R.string.todo_alarm_stop), stop)
        if (p.alarm) b.setFullScreenIntent(open, true).setOngoing(true)
        val n = b.build()
        if (p.alarm) n.flags = n.flags or Notification.FLAG_INSISTENT
        NotifyKit.post(context, p.key, Constants.NOTIFY_ID_TODO, n)
    }
}
