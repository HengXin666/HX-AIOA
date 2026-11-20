package com.hengxin.aioa.update

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import com.hengxin.aioa.R

// 静默安装会话的回调: 成功清理安装包; 需要确认或失败时, 改走系统安装界面兜底
class InstallReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_SUCCESS -> Updater.cleanup(context)
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                val confirm = confirmIntent(intent)?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                Installer.notify(context, context.getString(R.string.update_confirm), confirm ?: manual(context))
            }
            else -> {
                val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE).orEmpty()
                Installer.notify(context, context.getString(R.string.update_failed, message), manual(context))
            }
        }
    }

    private fun manual(context: Context): Intent? = Updater.pendingApk(context)?.let { Installer.viewIntent(context, it) }

    private fun confirmIntent(intent: Intent): Intent? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(Intent.EXTRA_INTENT)
        }
}
