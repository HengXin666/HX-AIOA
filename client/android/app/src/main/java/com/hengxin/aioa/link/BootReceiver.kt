package com.hengxin.aioa.link

import android.app.AlarmManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.hengxin.aioa.config.ConfigStore

// 需要在系统设置里打开 "自启动", 红米重启后才会收到这条广播
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (ConfigStore.load(context) == null) return
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> {
                LinkService.start(context)
                // 重启或升级后系统清掉了闹钟, 按存的计划补挂
                TodoAlarms.restore(context)
            }
            // 用户刚给了精确闹钟权限: 之前挂的不精确闹钟改挂成精确的
            AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED -> TodoAlarms.restore(context)
        }
    }
}
