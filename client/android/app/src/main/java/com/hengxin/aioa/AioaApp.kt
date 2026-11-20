package com.hengxin.aioa

import android.annotation.SuppressLint
import android.app.Application
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.provider.Settings
import com.hengxin.aioa.update.Updater

class AioaApp : Application() {

    override fun onCreate() {
        super.onCreate()
        Thread { runCatching { Updater.cleanup(this) } }.start()
        createChannels()
    }

    private fun createChannels() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.deleteNotificationChannel(Constants.CHANNEL_MESSAGE_LEGACY)
        manager.createNotificationChannel(
            NotificationChannel(Constants.CHANNEL_LINK, getString(R.string.channel_link), NotificationManager.IMPORTANCE_MIN),
        )
        val message = NotificationChannel(
            Constants.CHANNEL_MESSAGE,
            getString(R.string.channel_message),
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
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
        manager.createNotificationChannel(message)
        manager.createNotificationChannel(
            NotificationChannel(Constants.CHANNEL_UPDATE, getString(R.string.channel_update), NotificationManager.IMPORTANCE_DEFAULT),
        )
    }

    companion object {
        // 用 ANDROID_ID 派生设备 id, 两个进程无需共享存储也能得到同一个值
        @SuppressLint("HardwareIds")
        fun deviceId(app: Application, role: String): String {
            val id = Settings.Secure.getString(app.contentResolver, Settings.Secure.ANDROID_ID)
            return "${Constants.DEVICE_PREFIX}-$role-${id.take(8)}"
        }

        // 界面进程是否在前台: 前台时由界面自己展示, :link 不再弹通知
        fun uiForeground(app: Application): Boolean {
            val am = app.getSystemService(android.app.ActivityManager::class.java)
            return am.runningAppProcesses.orEmpty().any {
                it.processName == app.packageName &&
                    it.importance == android.app.ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
            }
        }
    }
}
