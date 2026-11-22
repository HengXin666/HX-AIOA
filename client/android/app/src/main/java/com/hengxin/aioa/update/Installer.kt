package com.hengxin.aioa.update

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.FileProvider
import com.hengxin.aioa.Constants
import com.hengxin.aioa.R
import com.hengxin.aioa.link.NotifyKit
import java.io.File

// 两条安装路径:
// 1. 本应用就是上次的安装来源且 Android 12+: PackageInstaller 会话静默安装
// 2. 其余情况: 交给系统安装界面 (ACTION_VIEW), 红米上这条路最稳, 不会出现会话被判定 "用户拒绝"
object Installer {

    private const val APK_MIME = "application/vnd.android.package-archive"
    private const val SESSION_NAME = "base.apk"
    private const val AUTHORITY_SUFFIX = ".files"
    private const val PERCENT_MAX = 100

    fun canSilent(context: Context): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && installerOf(context) == context.packageName

    // 返回给界面看的说明
    fun install(context: Context, apk: File, foreground: Boolean): String {
        if (canSilent(context)) {
            silent(context, apk)
            return "正在静默安装, 完成后应用会自动重启"
        }
        val intent = viewIntent(context, apk)
        if (foreground && runCatching { context.startActivity(intent) }.isSuccess) {
            return "已打开系统安装界面, 点 \"安装\" 即可"
        }
        notify(context, context.getString(R.string.update_confirm), intent)
        return "已下载, 点通知栏里的提示安装"
    }

    fun viewIntent(context: Context, apk: File): Intent {
        val uri = FileProvider.getUriForFile(context, context.packageName + AUTHORITY_SUFFIX, apk)
        return Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, APK_MIME)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    }

    fun notify(context: Context, text: String, action: Intent?) {
        val builder = NotifyKit.builder(context, Constants.CHANNEL_UPDATE, R.drawable.ic_stat_update)
            .setContentTitle(context.getString(R.string.app_name))
            .setContentText(text)
            .setAutoCancel(true)
        if (action != null) {
            val flags = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            builder.setContentIntent(PendingIntent.getActivity(context, 0, action, flags))
        }
        NotifyKit.post(context, null, Constants.NOTIFY_ID_UPDATE, builder.build())
    }

    /** 下载进度条: 只提醒一次, 之后静默刷新。 */
    fun progress(context: Context, label: String, percent: Int) {
        val n = NotifyKit.builder(context, Constants.CHANNEL_UPDATE, R.drawable.ic_stat_update)
            .setContentTitle(context.getString(R.string.update_downloading))
            .setContentText(context.getString(R.string.update_progress, label, percent))
            .setProgress(PERCENT_MAX, percent, false)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .build()
        NotifyKit.post(context, null, Constants.NOTIFY_ID_UPDATE, n)
    }

    /** 下载结束 (成功或失败) 撤掉进度条, 后续的安装提示另发。 */
    fun clearProgress(context: Context) = NotifyKit.cancel(context, null, Constants.NOTIFY_ID_UPDATE)

    private fun silent(context: Context, apk: File) {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        params.setAppPackageName(context.packageName)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        }
        val sessionId = installer.createSession(params)
        installer.openSession(sessionId).use { session ->
            session.openWrite(SESSION_NAME, 0, apk.length()).use { out ->
                apk.inputStream().use { it.copyTo(out) }
                session.fsync(out)
            }
            val callback = PendingIntent.getBroadcast(
                context,
                sessionId,
                Intent(Constants.ACTION_INSTALL_RESULT).setPackage(context.packageName),
                PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            session.commit(callback.intentSender)
        }
    }

    private fun installerOf(context: Context): String? = runCatching {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            context.packageManager.getInstallSourceInfo(context.packageName).installingPackageName
        } else {
            @Suppress("DEPRECATION")
            context.packageManager.getInstallerPackageName(context.packageName)
        }
    }.getOrNull()
}
