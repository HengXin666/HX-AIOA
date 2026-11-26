package com.hengxin.aioa.net

import android.app.Notification
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.hengxin.aioa.Constants
import com.hengxin.aioa.R
import com.hengxin.aioa.link.NotifyKit

/**
 * 用户主动发起的短传输 (目前是头像) 的前台服务: 只在有传输时存在, 界面进程, 不进 :link。
 * 作用是切到后台时不被冻结, 并在通知里显示进度; 传完立即停。
 */
class TransferService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // startForegroundService 之后必须先进前台, 再看要不要停, 否则系统会让应用崩溃
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC else 0
        runCatching { ServiceCompat.startForeground(this, Constants.NOTIFY_ID_TRANSFER, build(this, current), type) }
        if (!active) stop()
        return START_NOT_STICKY
    }

    // Android 15 起 dataSync 有累计时长上限, 到点系统回调这里, 必须停
    override fun onTimeout(startId: Int, fgsType: Int) = stop()

    override fun onDestroy() {
        if (instance === this) instance = null
        super.onDestroy()
    }

    private fun stop() {
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private data class Shown(val title: String, val text: String, val percent: Int?)

    companion object {
        private const val PERCENT_MAX = 100
        private const val POST_GAP_MS = 500L
        @Volatile private var postedAt = 0L
        private val main = Handler(Looper.getMainLooper())
        @Volatile private var instance: TransferService? = null
        @Volatile private var active = false
        @Volatile private var current = Shown("", "", 0)

        /** 显示或更新进度; percent 为 null 表示不定进度。第一次调用时起服务, 要在界面可见时 (用户刚点上传) 调。 */
        fun show(context: Context, title: String, text: String, percent: Int?) {
            current = Shown(title, text, percent)
            if (!active) {
                active = true
                val started = runCatching { ContextCompat.startForegroundService(context, Intent(context, TransferService::class.java)) }
                // 后台不允许起前台服务时照样上传, 只是没有通知
                if (started.isFailure) active = false
                return
            }
            // 系统对同一应用的通知更新有频率限制, 太密会被丢弃; 不定进度 (等服务端) 总要显示
            val now = System.currentTimeMillis()
            if (instance == null || (percent != null && now - postedAt < POST_GAP_MS)) return
            postedAt = now
            NotifyKit.post(context, null, Constants.NOTIFY_ID_TRANSFER, build(context, current))
        }

        /** 全部传完: 服务还没起来就等它起来后自己停。 */
        fun finish(context: Context) {
            if (!active) return
            active = false
            main.post { if (!active) instance?.stop() }
        }

        private fun build(context: Context, s: Shown): Notification =
            NotifyKit.builder(context, Constants.CHANNEL_LINK, R.drawable.ic_stat_app)
                .setContentTitle(s.title.ifEmpty { context.getString(R.string.transfer_avatar) })
                .setContentText(s.text)
                .setProgress(PERCENT_MAX, s.percent ?: 0, s.percent == null)
                .setContentIntent(NotifyKit.openApp(context))
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_PROGRESS)
                .build()
    }
}
