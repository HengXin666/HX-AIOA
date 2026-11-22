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
import com.hengxin.aioa.proto.shouldNotify
import com.hengxin.aioa.proto.toMsg
import java.util.concurrent.Executors

// 运行在独立的 :link 进程, 不加载任何 UI 类: 一条长连接, 本地消息库, 按需的代理内核, 搭便车的低频维护
class LinkService : Service(), LinkSocket.Listener {

    private lateinit var socket: LinkSocket
    private lateinit var db: MessageDb
    private lateinit var notifier: Notifier
    private lateinit var picker: NodePicker
    private lateinit var watchdog: LinkWatchdog
    private lateinit var maintenance: Maintenance
    private val handler = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()

    // 补拉 (seq <= welcome.head) 的事件只入库不弹通知
    private var replayHead = 0L

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
        LinkStats.load(this)
        val device = AioaApp.deviceId(application, Constants.DEVICE_LINK)
        socket = LinkSocket(this, device, db::maxSeq, this, forLink = true, pingSec = Constants.LINK_PING_INTERVAL_SEC)
        picker = NodePicker(this) { handler.post { socket.restart() } }
        maintenance = Maintenance(this, io)
        watchdog = LinkWatchdog(this, socket) { maintenance.runIfDue() }
        LinkLog.add(this, "后台服务启动")
        socket.start()
        picker.start()
        watchdog.start()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            Constants.ACTION_RELOAD -> picker.reload()
            Constants.ACTION_OPTIMIZE -> picker.optimizeSoon()
            Constants.ACTION_PROXY_DEMAND -> picker.demand()
        }
        return START_STICKY
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        LinkLog.add(this, "后台服务被销毁")
        LinkStats.flush(this)
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

    override fun onNetwork() = watchdog.onNetworkChanged()

    override fun onFrame(frame: ServerFrame) {
        when (frame) {
            is ServerFrame.Welcome -> replayHead = frame.head
            is ServerFrame.Msg -> store(frame, notify = true)
            is ServerFrame.Ev -> if (frame.ev.kind != Constants.KIND_METRIC) {
                store(frame.ev.toMsg(), notify = frame.ev.shouldNotify() && frame.ev.seq > replayHead)
            }
            else -> Unit
        }
    }

    private fun store(msg: ServerFrame.Msg, notify: Boolean) {
        val fresh = db.insert(msg)
        socket.send(Frames.ack(msg.seq))
        if (!notify || !fresh || msg.src.startsWith(Constants.DEVICE_PREFIX)) return
        if (AioaApp.uiForeground(application)) return
        notifier.showUnread(db.unread(Constants.DEVICE_PREFIX, Constants.NOTIFY_MAX_LINES), db.unreadCount(Constants.DEVICE_PREFIX))
    }

    companion object {
        fun start(context: Context, action: String? = null) {
            ContextCompat.startForegroundService(context, Intent(context, LinkService::class.java).setAction(action))
        }
    }
}
