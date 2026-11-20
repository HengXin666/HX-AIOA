package com.hengxin.aioa.link

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.hengxin.aioa.AioaApp
import com.hengxin.aioa.Constants
import com.hengxin.aioa.proto.Frames
import com.hengxin.aioa.proto.ServerFrame

// 运行在独立的 :link 进程, 不加载任何 UI 类, 后台只剩一条连接和少量对象
class LinkService : Service(), LinkSocket.Listener {

    private lateinit var socket: LinkSocket
    private lateinit var seqStore: SeqStore
    private lateinit var notifier: Notifier

    override fun onCreate() {
        super.onCreate()
        notifier = Notifier(this)
        seqStore = SeqStore(this)
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
        } else {
            0
        }
        ServiceCompat.startForeground(this, Constants.NOTIFY_ID_LINK, notifier.linkNotification(), type)
        val device = AioaApp.deviceId(application, Constants.DEVICE_LINK)
        socket = LinkSocket(this, device, seqStore::last, this)
        socket.start()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onDestroy() {
        socket.stop()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStatus(online: Boolean) = Unit

    override fun onFrame(frame: ServerFrame) {
        if (frame !is ServerFrame.Msg || frame.seq <= seqStore.last()) return
        seqStore.save(frame.seq)
        if (!frame.src.startsWith(Constants.DEVICE_PREFIX)) notifier.showMessage(frame)
        socket.send(Frames.ack(frame.seq))
    }

    companion object {
        fun start(context: Context) {
            ContextCompat.startForegroundService(context, Intent(context, LinkService::class.java))
        }
    }
}
