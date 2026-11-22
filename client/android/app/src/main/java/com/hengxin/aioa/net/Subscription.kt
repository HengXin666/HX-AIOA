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
    private const val TIMEOUT_SEC = 10L
    private const val DIRECT_TRIES = 2
    private const val IMPORT_FILE = "sub.yaml"
    private val RELAY_PATH = listOf("api/v1/relay/subscription")
    private val lock = Any()
    private const val SNIPPET = 60
    private const val HTTP_FORBIDDEN = 403
    private const val CF_HEADER = "cf-mitigated"
    private const val SERVER_HEADER = "server"
    private val BLANKS = Regex("\\s+")
    private val USER_AGENTS = listOf(
        "clash-verge/v2.2.3",
        "ClashMetaForAndroid/2.11.5.Meta",
        "mihomo/1.19.0",
        "clash.meta",
        "Clash",
        "v2rayN/7.10.0",
        "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36",
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

    // 同一进程里只跑一份, 重复点击或多处同时触发时等前一份结束直接用它的结果
    fun download(context: Context, url: String): SubStatus {
        val started = now()
        synchronized(lock) {
            status(context)?.takeIf { it.at >= started }?.let { return it }
            return downloadLocked(context, url)
        }
    }

    // 顺序: 直连试两个 UA, 再让服务端在境外代拉 (机场屏蔽国内 IP 时), 内核在跑时最后走代理
    private fun downloadLocked(context: Context, url: String): SubStatus {
        imported(context)?.let { return done(context, it, "导入文件") }
        val failures = mutableListOf<String>()
        for (ua in USER_AGENTS.take(DIRECT_TRIES)) {
            val result = runCatching { fetch(url, Proxy.NO_PROXY, ua) }.getOrElse { Attempt(null, it.message ?: it.javaClass.simpleName) }
            if (result.body != null) return done(context, result.body, "直连")
            failures += "直连/$ua: ${result.error}"
            if (result.fatal) break
        }
        val relayed = Api.call(context, "POST", RELAY_PATH, JSONObject().put("url", url))
        val relayBody = relayed.body?.optString("body").orEmpty()
        if (relayBody.isNotBlank() && !relayBody.trimStart().startsWith("<")) return done(context, relayBody, "服务端代拉")
        failures += "服务端代拉: ${relayed.error ?: "返回内容不是订阅"}"
        if (ProxyCore.listening()) {
            val proxy = Net.proxy(context, forLink = false)
            for (ua in USER_AGENTS) {
                val routeName = "代理"
                val result = runCatching { fetch(url, proxy, ua) }.getOrElse { Attempt(null, it.message ?: it.javaClass.simpleName) }
                if (result.body != null) return done(context, result.body, routeName)
                failures += "$routeName/$ua: ${result.error}"
                if (result.fatal) break
            }
        }
        return save(context, SubStatus(false, now(), "订阅下载失败: " + failures.joinToString("; ")))
    }

    // 机场把国内 IP 和云厂商出口都拦了时, 从电脑拉好放到 App 外部目录 (adb push 可写), 读一次就删
    private fun imported(context: Context): String? {
        val f = File(context.getExternalFilesDir(null) ?: return null, IMPORT_FILE)
        if (!f.exists()) return null
        val text = runCatching { f.readText() }.getOrNull()
        f.delete()
        return text?.takeIf { it.isNotBlank() && !it.trimStart().startsWith("<") }
    }

    private fun done(context: Context, body: String, route: String): SubStatus {
        write(file(context), body)
        return save(context, SubStatus(true, now(), "订阅下载成功 ($route, ${body.length} 字节)"))
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
                val hint = text.replace(BLANKS, " ").trim().take(SNIPPET).ifEmpty { resp.header(SERVER_HEADER).orEmpty() }
                val reason = (if (challenge) "HTTP ${resp.code} Cloudflare 人机验证拦截" else "HTTP ${resp.code}") + if (hint.isEmpty()) "" else " ($hint)"
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
