package com.hengxin.aioa.link

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import com.hengxin.aioa.Constants
import com.hengxin.aioa.config.ConfigStore
import com.hengxin.aioa.net.Net
import com.hengxin.aioa.proto.Frames
import com.hengxin.aioa.proto.ServerFrame
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit

// 单条长连接: 协议层 ping 保活 (服务端不计费也不唤醒), 网络切换立即重连, 失败指数退避
class LinkSocket(
    private val context: Context,
    private val device: String,
    private val since: () -> Long,
    private val listener: Listener,
    private val forLink: Boolean,
) {
    interface Listener {
        fun onFrame(frame: ServerFrame)
        fun onStatus(online: Boolean)
    }

    private val connectivity = context.getSystemService(ConnectivityManager::class.java)
    // 建连 (含读配置, 探测本机代理端口) 放在后台线程, 回调统一切回主线程
    private val handler = Handler(worker.looper)
    private val main = Handler(Looper.getMainLooper())
    private val client = Net.base.newBuilder()
        .pingInterval(Constants.PING_INTERVAL_SEC, TimeUnit.SECONDS)
        .build()

    @Volatile
    private var socket: WebSocket? = null
    private var retryMs = Constants.RECONNECT_MIN_MS

    @Volatile
    private var running = false
    private val reconnectTask = Runnable { connect() }

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            handler.post { reconnectNow() }
        }
    }

    // 注册网络回调时系统会立刻回调一次 onAvailable, 由它发起首次连接
    fun start() {
        if (running) return
        running = true
        connectivity.registerDefaultNetworkCallback(networkCallback)
    }

    fun stop() {
        if (!running) return
        running = false
        connectivity.unregisterNetworkCallback(networkCallback)
        handler.removeCallbacks(reconnectTask)
        socket?.close(Constants.NORMAL_CLOSE, null)
        socket = null
    }

    fun send(text: String): Boolean = socket?.send(text) ?: false

    // 代理可用性变化后调用, 让连接按新路径重建
    fun restart() {
        handler.post { reconnectNow() }
    }

    private fun reconnectNow() {
        if (!running) return
        handler.removeCallbacks(reconnectTask)
        retryMs = Constants.RECONNECT_MIN_MS
        connect()
    }

    private fun connect() {
        if (!running) return
        socket?.cancel()
        val config = ConfigStore.load(context) ?: return
        val base = runCatching { config.server.toHttpUrl() }.getOrNull() ?: return
        val url = base.newBuilder()
            .addPathSegment(Constants.WS_PATH)
            .addQueryParameter(Constants.QUERY_TOKEN, config.token)
            .addQueryParameter(Constants.QUERY_DEVICE, device)
            .addQueryParameter(Constants.QUERY_SINCE, since().toString())
            .build()
        val routed = client.newBuilder().proxy(Net.proxy(context, forLink)).build()
        socket = routed.newWebSocket(Request.Builder().url(url).build(), SocketListener())
    }

    private fun scheduleReconnect() {
        if (!running) return
        handler.removeCallbacks(reconnectTask)
        handler.postDelayed(reconnectTask, retryMs)
        retryMs = (retryMs * 2).coerceAtMost(Constants.RECONNECT_MAX_MS)
    }

    private inner class SocketListener : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            handler.post { retryMs = Constants.RECONNECT_MIN_MS }
            main.post { listener.onStatus(true) }
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            val frame = Frames.parse(text) ?: return
            main.post { listener.onFrame(frame) }
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = lost(webSocket)

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = lost(webSocket)

        private fun lost(webSocket: WebSocket) {
            handler.post {
                if (webSocket !== socket) return@post
                main.post { listener.onStatus(false) }
                scheduleReconnect()
            }
        }
    }

    private companion object {
        val worker: HandlerThread by lazy { HandlerThread("link-socket").apply { start() } }
    }
}
