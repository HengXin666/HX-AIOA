package com.hengxin.aioa.net

import android.content.Context
import com.hengxin.aioa.Constants
import com.hengxin.aioa.config.ConfigStore
import com.hengxin.aioa.config.JsonFile
import com.hengxin.aioa.link.DebugForward
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import okhttp3.ConnectionPool
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.net.InetSocketAddress
import java.net.Proxy
import java.util.concurrent.TimeUnit

// 空闲连接留 5 分钟: 新建连接的 TLS 握手要 0.5 到 1.7 秒, 复用只要一个来回 (#159)
private const val POOL_IDLE = 8
private const val POOL_KEEP_MIN = 5L
private const val WARM_GAP_MS = 60_000L
private const val HEALTH = "health"

/**
 * 所有对外请求都从这里拿 OkHttpClient: 配了订阅且内核在跑就走本机 SOCKS, 否则直连。
 * 各处一律从 base 用 newBuilder 派生, 共用一个连接池与调度器 (HTTP/2 下同一主机只要一条连接), 不要再 new OkHttpClient。
 */
object Net {
    val base: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectionPool(ConnectionPool(POOL_IDLE, POOL_KEEP_MIN, TimeUnit.MINUTES))
            .protocols(listOf(Protocol.HTTP_2, Protocol.HTTP_1_1))
            .build()
    }
    private val bg = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    @Volatile private var warmedAt = 0L

    /** 后台先连上服务端 (HEAD /health), 真正的请求来时直接复用连接, 不再等握手; 一分钟内只做一次。 */
    fun warm(context: Context) {
        val now = System.currentTimeMillis()
        if (now - warmedAt < WARM_GAP_MS) return
        warmedAt = now
        val app = context.applicationContext
        bg.launch {
            val server = ConfigStore.load(app)?.server?.trimEnd('/') ?: return@launch
            val req = runCatching { Request.Builder().url("$server/$HEALTH").head().build() }.getOrNull() ?: return@launch
            runCatching { client(app).newCall(req).execute().close() }.onFailure { warmedAt = 0L }
        }
    }

    fun proxy(context: Context, forLink: Boolean): Proxy {
        val config = ConfigStore.load(context) ?: return Proxy.NO_PROXY
        if (!config.proxyEnabled || (forLink && !config.proxyLink)) return Proxy.NO_PROXY
        if (!ProxyCore.listening()) return Proxy.NO_PROXY
        return Proxy(Proxy.Type.SOCKS, InetSocketAddress(Constants.LOOPBACK, Constants.PROXY_PORT))
    }

    fun client(context: Context, forLink: Boolean = false): OkHttpClient =
        base.newBuilder().proxy(proxy(context, forLink)).addInterceptor(DebugForward.Http(context.applicationContext)).build()
}

data class ProxyStatus(val node: String, val delayMs: Int, val at: Long, val nodes: Int)

// 优选结果由 :link 写入, 界面读取展示
object ProxyStatusStore {
    private const val FILE_NAME = "proxy_status.json"

    fun load(context: Context): ProxyStatus? = JsonFile.read(file(context))?.let {
        ProxyStatus(it.optString("node"), it.optInt("delay"), it.optLong("at"), it.optInt("nodes"))
    }

    fun save(context: Context, status: ProxyStatus) = JsonFile.write(
        file(context),
        JSONObject().put("node", status.node).put("delay", status.delayMs).put("at", status.at).put("nodes", status.nodes),
    )

    private fun file(context: Context) = File(context.filesDir, FILE_NAME)
}
