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

// 单条长连接: 优先连 v1 流, 服务端还没有 v1 (握手 404) 时退回旧 /ws; 网络切换立即重连, 失败指数退避
// pingSec 为 0 时不开 OkHttp 协议 ping, 心跳完全交给看门狗的 check, 一条连接只有一个心跳来源
class LinkSocket(
    private val context: Context,
    private val device: String,
    private val since: () -> Long,
    private val listener: Listener,
    private val forLink: Boolean,
    pingSec: Long = Constants.UI_PING_INTERVAL_SEC,
) {
    interface Listener {
        fun onFrame(frame: ServerFrame)
        fun onStatus(online: Boolean)
        fun onNetwork() {}
    }

    /** 一次健康检查的结论, 看门狗据此调整心跳间隔并决定何时释放唤醒锁。 */
    enum class Probe { ALIVE, SKIPPED, DEAD, OFFLINE }

    private val connectivity = context.getSystemService(ConnectivityManager::class.java)
    // 建连 (含读配置, 探测本机代理端口) 放在后台线程, 回调统一切回主线程
    private val handler = Handler(worker.looper)
    private val main = Handler(Looper.getMainLooper())
    private val client = Net.base.newBuilder()
        .pingInterval(pingSec, TimeUnit.SECONDS)
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
    private var probeDone: ((Probe) -> Unit)? = null
    // 旧服务端没有 v1 流时置位, 本进程内不再尝试 v1
    private var legacy = false

    @Volatile
    private var lastRx = 0L
    private val reconnectTask = Runnable { connect() }
    private val probeCheck = Runnable { verifyProbe() }

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            handler.post { log("网络可用"); reconnectNow() }
            main.post { listener.onNetwork() }
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

    /** 距上次收到任何数据的毫秒数, 用它判断 NAT 映射是否刚被刷新过。 */
    fun idleMs(): Long = SystemClock.elapsedRealtime() - lastRx

    // 看门狗调用: 没连上且不在建连中就立刻重连; 在线且最近 skipIdleMs 内有流量就不发探测, 否则发文本 ping 等 pong
    fun check(skipIdleMs: Long, done: (Probe) -> Unit) = handler.post {
        if (!running) return@post done(Probe.OFFLINE)
        val now = SystemClock.elapsedRealtime()
        when {
            open && now - lastRx < skipIdleMs -> done(Probe.SKIPPED)
            open -> probe(now, done)
            now - connectAt > Constants.CONNECT_STALL_MS -> {
                log("看门狗: 当前离线, 立即重连")
                reconnectNow()
                done(Probe.OFFLINE)
            }
            else -> done(Probe.OFFLINE)
        }
    }

    private fun probe(now: Long, done: (Probe) -> Unit) {
        probeAt = now
        if (socket?.send(Frames.PING) != true) {
            log("看门狗: 发送探测失败, 重连")
            reconnectNow()
            return done(Probe.DEAD)
        }
        probeDone?.invoke(Probe.SKIPPED)
        probeDone = done
        handler.removeCallbacks(probeCheck)
        handler.postDelayed(probeCheck, Constants.PROBE_TIMEOUT_MS)
    }

    private fun onPong() {
        lastPong = SystemClock.elapsedRealtime()
        val done = probeDone ?: return
        probeDone = null
        handler.removeCallbacks(probeCheck)
        done(Probe.ALIVE)
    }

    private fun verifyProbe() {
        val done = probeDone
        probeDone = null
        if (!running || !open) return done?.invoke(Probe.OFFLINE) ?: Unit
        if (lastPong >= probeAt) return done?.invoke(Probe.ALIVE) ?: Unit
        log("看门狗: ${Constants.PROBE_TIMEOUT_MS / MS_PER_SEC}s 内没收到 pong, 连接已死, 重连")
        reconnectNow()
        done?.invoke(Probe.DEAD)
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
        handler.removeCallbacks(probeCheck)
        probeDone?.invoke(Probe.OFFLINE)
        probeDone = null
        connectAt = SystemClock.elapsedRealtime()
        val config = ConfigStore.load(context) ?: return log("未配置服务端, 不连接")
        val base = runCatching { config.server.toHttpUrl() }.getOrNull() ?: return log("服务端地址无效")
        val builder = base.newBuilder()
        if (legacy) {
            builder.addPathSegment(Constants.WS_PATH)
        } else {
            builder.addPathSegments(Constants.STREAM_PATH).addQueryParameter(Constants.QUERY_ROLE, Constants.ROLE_CLIENT)
        }
        val url = builder
            .addQueryParameter(Constants.QUERY_TOKEN, config.token)
            .addQueryParameter(Constants.QUERY_DEVICE, device)
            .addQueryParameter(Constants.QUERY_SINCE, since().toString())
            .build()
        val proxy = Net.proxy(context, forLink)
        val route = if (proxy.type() == java.net.Proxy.Type.DIRECT) "直连" else "代理"
        log("开始连接 ($route, ${if (legacy) "旧 /ws" else "v1"})")
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
                lastRx = SystemClock.elapsedRealtime()
                retryMs = Constants.RECONNECT_MIN_MS
                if (forLink) LinkStats.hit(LinkStats.Key.CONNECT)
                log("已连接")
            }
            main.post { listener.onStatus(true) }
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            lastRx = SystemClock.elapsedRealtime()
            if (text == Frames.PONG) {
                handler.post { onPong() }
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

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            if (response?.code == HTTP_NOT_FOUND && !legacy) {
                handler.post { if (webSocket === socket) legacy = true }
            }
            lost(webSocket, "连接失败: ${response?.code?.let { "HTTP $it " }.orEmpty()}${t.javaClass.simpleName} ${t.message.orEmpty()}")
        }

        private fun lost(webSocket: WebSocket, why: String) {
            handler.post {
                if (webSocket !== socket) return@post
                log(why)
                if (forLink && open) LinkStats.hit(LinkStats.Key.DISCONNECT)
                socket = null
                open = false
                probeDone?.invoke(Probe.DEAD)
                probeDone = null
                main.post { listener.onStatus(false) }
                scheduleReconnect()
            }
        }
    }

    private companion object {
        const val MS_PER_SEC = 1000L
        const val HTTP_NOT_FOUND = 404
        val worker: HandlerThread by lazy { HandlerThread("link-socket").apply { start() } }
    }
}
