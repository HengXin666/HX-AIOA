package com.hengxin.aioa.link

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.SystemClock
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

// 单条长连接: 协议层 ping 保活 (服务端不计费也不唤醒), 网络切换立即重连, 失败指数退避, 看门狗兜底深睡后的假在线
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
    // 以下状态只在 handler 线程读写
    private var open = false
    private var connectAt = 0L
    private var probeAt = 0L
    private var lastPong = 0L
    private val reconnectTask = Runnable { connect() }
    private val probeCheck = Runnable { verifyProbe() }

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            handler.post { log("网络可用"); reconnectNow() }
        }

        override fun onLost(network: Network) {
            handler.post { log("网络断开") }
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
        handler.post { log("代理路径变化, 重建连接"); reconnectNow() }
    }

    // 看门狗调用: 没连上且不在建连中就立刻重连; 显示在线则发应用层 ping, 等不到 pong 就判死重连
    fun check() = handler.post {
        if (!running) return@post
        val now = SystemClock.elapsedRealtime()
        when {
            open -> probe(now)
            now - connectAt > Constants.CONNECT_STALL_MS -> {
                log("看门狗: 当前离线, 立即重连")
                reconnectNow()
            }
            else -> Unit
        }
    }

    private fun probe(now: Long) {
        probeAt = now
        if (socket?.send(Frames.PING) != true) {
            log("看门狗: 发送探测失败, 重连")
            reconnectNow()
            return
        }
        handler.removeCallbacks(probeCheck)
        handler.postDelayed(probeCheck, Constants.PROBE_TIMEOUT_MS)
    }

    private fun verifyProbe() {
        if (!running || !open || lastPong >= probeAt) return
        log("看门狗: ${Constants.PROBE_TIMEOUT_MS / MS_PER_SEC}s 内没收到 pong, 连接已死, 重连")
        reconnectNow()
    }

    private fun log(event: String) {
        LinkLog.add(context, if (forLink) event else "[界面] $event")
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
        socket = null
        open = false
        connectAt = SystemClock.elapsedRealtime()
        val config = ConfigStore.load(context) ?: return log("未配置服务端, 不连接")
        val base = runCatching { config.server.toHttpUrl() }.getOrNull() ?: return log("服务端地址无效")
        val url = base.newBuilder()
            .addPathSegment(Constants.WS_PATH)
            .addQueryParameter(Constants.QUERY_TOKEN, config.token)
            .addQueryParameter(Constants.QUERY_DEVICE, device)
            .addQueryParameter(Constants.QUERY_SINCE, since().toString())
            .build()
        val proxy = Net.proxy(context, forLink)
        log(if (proxy.type() == java.net.Proxy.Type.DIRECT) "开始连接 (直连)" else "开始连接 (代理)")
        val routed = client.newBuilder().proxy(proxy).build()
        socket = routed.newWebSocket(Request.Builder().url(url).build(), SocketListener())
    }

    private fun scheduleReconnect() {
        if (!running) return
        handler.removeCallbacks(reconnectTask)
        handler.postDelayed(reconnectTask, retryMs)
        log("${retryMs}ms 后重连")
        retryMs = (retryMs * 2).coerceAtMost(Constants.RECONNECT_MAX_MS)
    }

    private inner class SocketListener : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            handler.post {
                if (webSocket !== socket) return@post
                open = true
                retryMs = Constants.RECONNECT_MIN_MS
                log("已连接")
            }
            main.post { listener.onStatus(true) }
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            if (text == Frames.PONG) {
                handler.post { lastPong = SystemClock.elapsedRealtime() }
                return
            }
            val frame = Frames.parse(text) ?: return
            main.post { listener.onFrame(frame) }
        }

        // 服务端发来关闭帧后必须回应, 否则 OkHttp 会一直挂着这条半关闭的连接, 永远等不到 onClosed
        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            webSocket.close(Constants.NORMAL_CLOSE, null)
            lost(webSocket, "服务端关闭 $code $reason")
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = lost(webSocket, "已关闭 $code $reason")

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) =
            lost(webSocket, "连接失败: ${response?.code?.let { "HTTP $it " }.orEmpty()}${t.javaClass.simpleName} ${t.message.orEmpty()}")

        private fun lost(webSocket: WebSocket, why: String) {
            handler.post {
                if (webSocket !== socket) return@post
                log(why)
                socket = null
                open = false
                main.post { listener.onStatus(false) }
                scheduleReconnect()
            }
        }
    }

    private companion object {
        const val MS_PER_SEC = 1000L
        val worker: HandlerThread by lazy { HandlerThread("link-socket").apply { start() } }
    }
}
