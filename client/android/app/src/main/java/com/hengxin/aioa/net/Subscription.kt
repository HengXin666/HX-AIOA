package com.hengxin.aioa.net

import android.content.Context
import com.hengxin.aioa.config.JsonFile
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.net.Proxy
import java.util.concurrent.TimeUnit

data class SubStatus(val ok: Boolean, val at: Long, val text: String)

// 订阅由 App 用 OkHttp 下载后交给内核按文件读取:
// 内核自带的 Go HTTP 客户端 TLS 指纹容易被机场前置的 Cloudflare 判成机器人 (403), 也拿不到具体原因
// 这里依次换几个常见客户端 UA, 先直连, 内核在跑时再试一次走代理, 把每一步的结果写进状态文件给界面看
object Subscription {
    private const val FILE_PATH = "providers/sub.yaml"
    private const val STATUS_FILE = "sub_status.json"
    private const val MAX_AGE_MS = 24 * 60 * 60_000L
    private const val TIMEOUT_SEC = 20L
    private const val SNIPPET = 60
    private const val HTTP_FORBIDDEN = 403
    private const val CF_HEADER = "cf-mitigated"
    private val USER_AGENTS = listOf(
        "clash-verge/v2.2.3",
        "ClashMetaForAndroid/2.11.5.Meta",
        "mihomo/1.19.0",
        "clash.meta",
    )

    // 内核配置里 proxy-provider 的 path, 相对于内核工作目录
    const val PROVIDER_PATH = "./$FILE_PATH"

    fun file(context: Context) = File(ProxyCore.home(context), FILE_PATH)

    fun stale(context: Context): Boolean {
        val f = file(context)
        return !f.exists() || System.currentTimeMillis() - f.lastModified() > MAX_AGE_MS
    }

    fun status(context: Context): SubStatus? = JsonFile.read(File(ProxyCore.home(context), STATUS_FILE))?.let {
        SubStatus(it.optBoolean("ok"), it.optLong("at"), it.optString("text"))
    }

    fun download(context: Context, url: String): SubStatus {
        val routes = buildList {
            add("直连" to Proxy.NO_PROXY)
            if (ProxyCore.listening()) add("代理" to Net.proxy(context, forLink = false))
        }
        val failures = mutableListOf<String>()
        for ((routeName, proxy) in routes) {
            for (ua in USER_AGENTS) {
                val result = runCatching { fetch(url, proxy, ua) }.getOrElse { Attempt(null, it.message ?: it.javaClass.simpleName) }
                if (result.body != null) {
                    write(file(context), result.body)
                    return save(context, SubStatus(true, now(), "订阅下载成功 ($routeName, ${result.body.length} 字节)"))
                }
                failures += "$routeName/$ua: ${result.error}"
                if (result.fatal) break
            }
        }
        return save(context, SubStatus(false, now(), "订阅下载失败: " + failures.joinToString("; ")))
    }

    private class Attempt(val body: String?, val error: String, val fatal: Boolean = false)

    private fun fetch(url: String, proxy: Proxy, ua: String): Attempt {
        val client = Net.base.newBuilder().proxy(proxy)
            .callTimeout(TIMEOUT_SEC, TimeUnit.SECONDS)
            .build()
        val request = Request.Builder().url(url).header("User-Agent", ua).header("Accept", "*/*").build()
        client.newCall(request).execute().use { resp ->
            val text = resp.body?.string().orEmpty()
            if (!resp.isSuccessful) {
                val challenge = resp.header(CF_HEADER) != null
                val reason = if (challenge) "HTTP ${resp.code} Cloudflare 人机验证拦截" else "HTTP ${resp.code}"
                return Attempt(null, reason, fatal = !challenge && resp.code != HTTP_FORBIDDEN)
            }
            val head = text.trimStart()
            if (head.isEmpty()) return Attempt(null, "返回内容为空")
            if (head.startsWith("<")) return Attempt(null, "返回的是网页而不是订阅: ${head.take(SNIPPET)}")
            return Attempt(text, "")
        }
    }

    private fun write(target: File, text: String) {
        target.parentFile?.mkdirs()
        val tmp = File(target.parentFile, target.name + ".tmp")
        tmp.writeText(text)
        tmp.renameTo(target)
    }

    private fun save(context: Context, status: SubStatus): SubStatus {
        JsonFile.write(
            File(ProxyCore.home(context), STATUS_FILE),
            JSONObject().put("ok", status.ok).put("at", status.at).put("text", status.text),
        )
        return status
    }

    private fun now() = System.currentTimeMillis()
}
