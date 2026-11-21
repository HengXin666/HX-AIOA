package com.hengxin.aioa.link

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.hengxin.aioa.AioaApp
import com.hengxin.aioa.Constants
import com.hengxin.aioa.data.MessageDb
import com.hengxin.aioa.net.NodePicker
import com.hengxin.aioa.proto.Frames
import com.hengxin.aioa.proto.ServerFrame
import com.hengxin.aioa.update.Updater
import java.util.concurrent.Executors

// 运行在独立的 :link 进程, 不加载任何 UI 类: 一条长连接, 本地消息库, 代理内核, 定时检查更新
class LinkService : Service(), LinkSocket.Listener {

    private lateinit var socket: LinkSocket
    private lateinit var db: MessageDb
    private lateinit var notifier: Notifier
    private lateinit var picker: NodePicker
    private lateinit var watchdog: LinkWatchdog
    private val handler = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()
    private val updateTask = object : Runnable {
        override fun run() {
            io.execute { runCatching { Updater(this@LinkService).update(foreground = false) { } } }
            handler.postDelayed(this, Constants.UPDATE_INTERVAL_MS)
        }
    }

    override fun onCreate() {
        super.onCreate()
        notifier = Notifier(this)
        db = MessageDb.get(this)
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
        } else {
            0
        }
        ServiceCompat.startForeground(this, Constants.NOTIFY_ID_LINK, notifier.linkNotification(), type)
        val device = AioaApp.deviceId(application, Constants.DEVICE_LINK)
        socket = LinkSocket(this, device, db::maxSeq, this, forLink = true)
        picker = NodePicker(this) { handler.post { socket.restart() } }
        watchdog = LinkWatchdog(this) { socket.check() }
        LinkLog.add(this, "后台服务启动")
        socket.start()
        picker.start()
        watchdog.start()
        handler.postDelayed(updateTask, UPDATE_FIRST_DELAY_MS)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            Constants.ACTION_RELOAD -> picker.reload()
            Constants.ACTION_OPTIMIZE -> picker.optimizeSoon()
        }
        return START_STICKY
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        LinkLog.add(this, "后台服务被销毁")
        watchdog.stop()
        socket.stop()
        picker.stop()
        io.shutdown()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStatus(online: Boolean) {
        if (!online) picker.optimizeSoon()
    }

    override fun onFrame(frame: ServerFrame) {
        if (frame !is ServerFrame.Msg) return
        val fresh = db.insert(frame)
        socket.send(Frames.ack(frame.seq))
        if (!fresh || frame.src.startsWith(Constants.DEVICE_PREFIX)) return
        if (AioaApp.uiForeground(application)) return
        notifier.showUnread(db.unread(Constants.DEVICE_PREFIX, Constants.NOTIFY_MAX_LINES), db.unreadCount(Constants.DEVICE_PREFIX))
    }

    companion object {
        private const val UPDATE_FIRST_DELAY_MS = 60_000L

        fun start(context: Context, action: String? = null) {
            ContextCompat.startForegroundService(context, Intent(context, LinkService::class.java).setAction(action))
        }
    }
}
