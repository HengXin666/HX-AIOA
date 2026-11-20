package com.hengxin.aioa.update

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.hengxin.aioa.Constants
import com.hengxin.aioa.R

// Android 8+ 安装 APK 需要 "安装未知应用" 授权; 前台直接打开授权页, 后台改发通知
object InstallPermission {

    private const val SCHEME_PACKAGE = "package"

    fun intent(context: Context): Intent =
        Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.fromParts(SCHEME_PACKAGE, context.packageName, null))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    fun request(context: Context) {
        val intent = intent(context)
        // 后台进程的 startActivity 会被系统静默拦截, 所以通知总是发一条兜底
        runCatching { context.startActivity(intent) }
        val pending = PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification = NotificationCompat.Builder(context, Constants.CHANNEL_UPDATE)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle(context.getString(R.string.app_name))
            .setContentText(context.getString(R.string.update_need_permission))
            .setContentIntent(pending)
            .setAutoCancel(true)
            .build()
        runCatching { NotificationManagerCompat.from(context).notify(Constants.NOTIFY_ID_UPDATE, notification) }
    }
}
