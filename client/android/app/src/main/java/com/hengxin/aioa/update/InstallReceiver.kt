package com.hengxin.aioa.update

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import android.widget.Toast
import com.hengxin.aioa.R

// 安装会话的回调: 成功清理安装包; 要确认时 App 在前台就直接拉起系统确认界面, 否则发通知; 失败提示并给系统安装界面兜底
class InstallReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_SUCCESS -> {
                Updater.cleanup(context)
                toast(context, context.getString(R.string.update_done))
            }
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                val confirm = confirmIntent(intent)?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                // Android 14+ 后台不能拉起界面, 只有 App 在前台时直接打开
                if (confirm != null && AutoUpdate.foreground && runCatching { context.startActivity(confirm) }.isSuccess) return
                Installer.notify(context, context.getString(R.string.update_confirm), confirm ?: manual(context))
            }
            // MIUI 等会直接中止会话安装 (不弹确认就回 ABORTED), 用户点 "取消" 也是这个状态:
            // 两种都改用系统安装界面, 并记住这台机器以后直接走系统安装界面
            PackageInstaller.STATUS_FAILURE_ABORTED -> {
                Installer.setPreferView(context, true)
                val view = manual(context)
                if (view != null && AutoUpdate.foreground && runCatching { context.startActivity(view) }.isSuccess) return
                toast(context, context.getString(R.string.update_aborted))
                Installer.notify(context, context.getString(R.string.update_confirm), view)
            }
            else -> {
                val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE).orEmpty()
                val text = context.getString(R.string.update_failed, message)
                toast(context, text)
                Installer.notify(context, text, manual(context))
            }
        }
    }

    private fun toast(context: Context, text: String) {
        if (AutoUpdate.foreground) Toast.makeText(context, text, Toast.LENGTH_LONG).show()
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
