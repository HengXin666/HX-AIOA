package com.hengxin.aioa.link

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import com.hengxin.aioa.Constants
import com.hengxin.aioa.R

/** 待办闹钟到点: 弹提醒通知; 设了闹钟的用闹钟渠道持续响铃, 直到点 "停止" 或划掉。跑在 :link 进程, 不碰界面类。 */
class TodoAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val key = intent.getStringExtra(TodoAlarms.EXTRA_KEY) ?: return
        if (intent.action == TodoAlarms.ACTION_STOP) return NotifyKit.cancel(context, key, Constants.NOTIFY_ID_TODO)
        val p = TodoAlarms.plan(context, key) ?: return
        if (!TodoAlarms.markFired(context, key)) return
        val stop = PendingIntent.getBroadcast(
            context,
            key.hashCode(),
            Intent(context, TodoAlarmReceiver::class.java).setAction(TodoAlarms.ACTION_STOP).putExtra(TodoAlarms.EXTRA_KEY, key),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val open = NotifyKit.openGroup(context, p.channel)
        val b = NotifyKit.builder(context, if (p.alarm) Constants.CHANNEL_TODO_ALARM else Constants.CHANNEL_TODO, R.drawable.ic_stat_alert)
            .setContentTitle(p.title)
            .setContentText(p.text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(p.text))
            .setContentIntent(open)
            .setWhen(p.at)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(if (p.alarm) NotificationCompat.CATEGORY_ALARM else NotificationCompat.CATEGORY_REMINDER)
            .addAction(0, context.getString(R.string.todo_alarm_stop), stop)
        if (p.alarm) b.setFullScreenIntent(open, true).setOngoing(true)
        val n = b.build()
        // 闹钟: 铃声循环到有人处理为止
        if (p.alarm) n.flags = n.flags or android.app.Notification.FLAG_INSISTENT
        NotifyKit.post(context, key, Constants.NOTIFY_ID_TODO, n)
    }
}
