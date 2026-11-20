package com.hengxin.aioa

import android.annotation.SuppressLint
import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.provider.Settings

class AioaApp : Application() {

    override fun onCreate() {
        super.onCreate()
        createChannels()
    }

    private fun createChannels() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(
                Constants.CHANNEL_LINK,
                getString(R.string.channel_link),
                NotificationManager.IMPORTANCE_MIN,
            ),
        )
        manager.createNotificationChannel(
            NotificationChannel(
                Constants.CHANNEL_MESSAGE,
                getString(R.string.channel_message),
                NotificationManager.IMPORTANCE_HIGH,
            ),
        )
    }

    companion object {
        // 用 ANDROID_ID 派生设备 id, 两个进程无需共享存储也能得到同一个值
        @SuppressLint("HardwareIds")
        fun deviceId(app: Application, role: String): String {
            val id = Settings.Secure.getString(app.contentResolver, Settings.Secure.ANDROID_ID)
            return "${Constants.DEVICE_PREFIX}-$role-${id.take(8)}"
        }
    }
}
