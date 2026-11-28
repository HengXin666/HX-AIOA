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
import com.hengxin.aioa.data.Me
import com.hengxin.aioa.data.MessageDb
import com.hengxin.aioa.data.MutedGroups
import com.hengxin.aioa.data.groupKey
import com.hengxin.aioa.net.NodePicker
import com.hengxin.aioa.proto.Envelope
import com.hengxin.aioa.proto.Frames
import com.hengxin.aioa.proto.ServerFrame
import com.hengxin.aioa.proto.shouldNotify
import com.hengxin.aioa.proto.Mentions
import com.hengxin.aioa.proto.toMsg
import java.io.FileDescriptor
import java.io.PrintWriter
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

    // 补拉 (seq <= welcome.head) 的事件: 断线期间错过的照常提醒, 首次同步 / resync / 太旧的只入库 (#149)
    private var replayHead = 0L
    private var replaySince = 0L
    private var replayResync = false
    private var replayNotified = 0

    override fun onCreate() {
        super.onCreate()
        db = MessageDb.get(this)
        notifier = Notifier(this, db)
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
        BatteryLog.start(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            Constants.ACTION_RELOAD -> picker.reload(intent.getBooleanExtra(Constants.EXTRA_FRESH, false))
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
        BatteryLog.stop(this)
        socket.stop()
        picker.stop()
        io.shutdown()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // adb shell dumpsys activity service com.hengxin.aioa/.link.LinkService [demand|reload|optimize]
    // dumpsys 在主线程回调, 探测端口和查节点要联网, 放到子线程里做
    override fun dump(fd: FileDescriptor?, writer: PrintWriter, args: Array<out String>?) {
        Thread { Diag.dump(this, picker, args, writer) }.apply { start(); join(DIAG_TIMEOUT_MS) }
    }

    override fun onStatus(online: Boolean) {
        if (online) watchdog.onOnline() else picker.optimizeSoon()
    }

    override fun onNetwork() = watchdog.onNetworkChanged()

    override fun onFrame(frame: ServerFrame) {
        LinkStats.hit(LinkStats.Key.RX)
        val used = frame is ServerFrame.Welcome || frame is ServerFrame.Msg || frame is ServerFrame.Ev || frame is ServerFrame.Task
        if (!used) LinkStats.hit(LinkStats.Key.RX_UNUSED)
        if (DebugReport.enabled(this)) LinkLog.add(this, "收到 ${frame.javaClass.simpleName}${if (used) "" else " (后台用不到)"}")
        when (frame) {
            is ServerFrame.Welcome -> {
                replayHead = frame.head
                // 帧按到达顺序在主线程处理, 此刻库里最大的 seq 就是建连时带的 since
                replaySince = db.maxSeq()
                replayResync = frame.resync
                replayNotified = 0
                Me.set(this, frame.uid, frame.name)
                if (frame.resync && frame.floor > 0) db.dropBefore(frame.floor)
            }
            is ServerFrame.Msg -> if (store(frame) && !AioaApp.uiForeground(application) && !quiet(frame)) notifier.message(frame)
            is ServerFrame.Ev -> if (frame.ev.kind != Constants.KIND_METRIC) onEvent(frame.ev)
            is ServerFrame.Task -> notifier.task(frame.task)
            else -> Unit
        }
    }

    // 补拉的旧事件不提醒; 界面在前台, 已恢复或安静路由时仍交给通知层, 只用来更新或撤掉已有的那条
    private fun onEvent(ev: Envelope) {
        val msg = ev.toMsg()
        // 撤回 / 删除: 本地删掉原消息, 撤掉还挂着的通知
        if (ev.deleted != null) {
            db.insert(msg)
            socket.send(Frames.ack(msg.seq))
            return notifier.retract(ev, msg)
        }
        if (!store(msg)) return
        if (ev.seq <= replayHead) {
            if (!LinkPolicy.notifyReplay(replaySince, replayResync, ev.ts, System.currentTimeMillis(), replayNotified)) return
            replayNotified++
        }
        notifier.event(ev, msg, loud = ev.shouldNotify() && !quiet(msg) && !AioaApp.uiForeground(application))
    }

    // 免打扰的群不响, 但 @ 到我或 @全体 的照样提醒 (#131)
    private fun quiet(msg: ServerFrame.Msg): Boolean =
        MutedGroups.contains(this, msg.groupKey()) && !Mentions.hits(msg.mentions, Me.uid)

    // 入库并确认; 返回是否是别处发来的新消息
    private fun store(msg: ServerFrame.Msg): Boolean {
        val fresh = db.insert(msg)
        socket.send(Frames.ack(msg.seq))
        return fresh && !msg.mine
    }

    companion object {
        private const val DIAG_TIMEOUT_MS = 15_000L
        fun start(context: Context, action: String? = null) {
            ContextCompat.startForegroundService(context, Intent(context, LinkService::class.java).setAction(action))
        }

        /** 配置变了: fresh 为 true 时 (订阅地址变了) 重新下载订阅并重启内核, 否则只按新配置调整。 */
        fun reload(context: Context, fresh: Boolean) {
            val intent = Intent(context, LinkService::class.java).setAction(Constants.ACTION_RELOAD).putExtra(Constants.EXTRA_FRESH, fresh)
            ContextCompat.startForegroundService(context, intent)
        }
    }
}
