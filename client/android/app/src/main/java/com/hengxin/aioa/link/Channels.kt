package com.hengxin.aioa.link

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.media.RingtoneManager
import androidx.annotation.StringRes
import com.hengxin.aioa.Constants
import com.hengxin.aioa.R

// 渠道 id 一旦创建, 重要性等设置就由用户掌控, 想改默认值只能换新 id; 旧的 message_v2 保留
object Channels {

    fun create(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.deleteNotificationChannel(Constants.CHANNEL_MESSAGE_LEGACY)
        val list = listOf(
            channel(context, Constants.CHANNEL_LINK, R.string.channel_link, R.string.channel_link_desc, NotificationManager.IMPORTANCE_MIN)
                .apply { setShowBadge(false) },
            loud(channel(context, Constants.CHANNEL_MESSAGE, R.string.channel_message, R.string.channel_message_desc, NotificationManager.IMPORTANCE_HIGH)),
            loud(channel(context, Constants.CHANNEL_ALERT, R.string.channel_alert, R.string.channel_alert_desc, NotificationManager.IMPORTANCE_HIGH)),
            loud(channel(context, Constants.CHANNEL_AGENT, R.string.channel_agent, R.string.channel_agent_desc, NotificationManager.IMPORTANCE_HIGH)),
            channel(context, Constants.CHANNEL_GITHUB, R.string.channel_github, R.string.channel_github_desc, NotificationManager.IMPORTANCE_DEFAULT),
            channel(context, Constants.CHANNEL_REPORT, R.string.channel_report, R.string.channel_report_desc, NotificationManager.IMPORTANCE_LOW),
            channel(context, Constants.CHANNEL_UPDATE, R.string.channel_update, R.string.channel_update_desc, NotificationManager.IMPORTANCE_DEFAULT),
        )
        manager.createNotificationChannels(list)
    }

    private fun channel(context: Context, id: String, @StringRes name: Int, @StringRes desc: Int, importance: Int) =
        NotificationChannel(id, context.getString(name), importance).apply { description = context.getString(desc) }

    // 需要像聊天软件那样顶部弹出的渠道: 震动, 灯光, 锁屏可见, 即时通讯音效
    private fun loud(c: NotificationChannel) = c.apply {
        enableVibration(true)
        vibrationPattern = Constants.VIBRATE_PATTERN
        enableLights(true)
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        setShowBadge(true)
        setSound(
            RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
            AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_COMMUNICATION_INSTANT).build(),
        )
    }
}
