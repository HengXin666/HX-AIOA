package com.hengxin.aioa.net

import android.content.Context
import com.hengxin.aioa.Constants
import com.hengxin.aioa.config.ConfigStore
import com.hengxin.aioa.config.JsonFile
import com.hengxin.aioa.link.DebugForward
import okhttp3.OkHttpClient
import org.json.JSONObject
import java.io.File
import java.net.InetSocketAddress
import java.net.Proxy

// 所有对外请求都从这里拿 OkHttpClient: 配了订阅且内核在跑就走本机 SOCKS, 否则直连
object Net {
    val base: OkHttpClient by lazy { OkHttpClient() }

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
