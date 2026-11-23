package com.hengxin.aioa

import android.annotation.SuppressLint
import android.app.Application
import android.provider.Settings
import com.hengxin.aioa.data.CrashLog
import com.hengxin.aioa.link.Channels
import com.hengxin.aioa.update.Updater

class AioaApp : Application() {

    override fun onCreate() {
        super.onCreate()
        CrashLog.install(this)
        com.hengxin.aioa.data.Me.load(this)
        Thread { runCatching { Updater.cleanup(this) } }.start()
        Channels.create(this)
        com.hengxin.aioa.config.SetupImport.apply(this)
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
