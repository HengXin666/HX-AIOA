package com.hengxin.aioa.link

import android.Manifest
import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.hengxin.aioa.Constants
import com.hengxin.aioa.R
import com.hengxin.aioa.proto.ServerFrame

class Notifier(private val context: Context) {

    // 用类名启动界面, 避免 :link 进程加载 Activity 及 Compose 相关类
    private val openApp: PendingIntent = PendingIntent.getActivity(
        context,
        0,
        Intent().setClassName(context, UI_ACTIVITY).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    fun linkNotification(): Notification =
        NotificationCompat.Builder(context, Constants.CHANNEL_LINK)
            .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
            .setContentTitle(context.getString(R.string.link_running))
            .setContentIntent(openApp)
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .build()

    fun showMessage(msg: ServerFrame.Msg) {
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        if (!granted) return
        val notification = NotificationCompat.Builder(context, Constants.CHANNEL_MESSAGE)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle(msg.src)
            .setContentText(msg.text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(msg.text))
            .setContentIntent(openApp)
            .setAutoCancel(true)
            .setWhen(msg.ts)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()
        NotificationManagerCompat.from(context).notify(Constants.NOTIFY_ID_MESSAGE, notification)
    }

    private companion object {
        const val UI_ACTIVITY = "com.hengxin.aioa.ui.MainActivity"
    }
}
