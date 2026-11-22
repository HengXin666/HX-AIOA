package com.hengxin.aioa.config

import android.content.Context
import org.json.JSONObject
import java.io.File

// 不再保存服务端 AUTH_TOKEN: App 只认账号登录, 万能令牌只留给脚本和管理接口
data class AppConfig(
    val server: String,
    val subscription: String = "",
    val proxyLink: Boolean = true,
) {
    val valid: Boolean get() = server.isNotBlank()
    val proxyEnabled: Boolean get() = subscription.isNotBlank()
}

// 小型 JSON 文件: 每次读取都走磁盘, 两个进程不会拿到对方的旧缓存
object JsonFile {
    private const val TMP_SUFFIX = ".tmp"

    fun read(file: File): JSONObject? = runCatching { JSONObject(file.readText()) }.getOrNull()

    fun write(file: File, json: JSONObject) {
        file.parentFile?.mkdirs()
        val tmp = File(file.parentFile, file.name + TMP_SUFFIX)
        tmp.writeText(json.toString())
        tmp.renameTo(file)
    }
}

object ConfigStore {
    private const val FILE_NAME = "config.json"
    private const val KEY_SERVER = "server"
    private const val KEY_SUBSCRIPTION = "subscription"
    private const val KEY_PROXY_LINK = "proxyLink"

    /** 可连接的配置: 有服务端地址且已登录账号, 否则为 null。 */
    fun load(context: Context): AppConfig? = read(context)?.takeIf { Auth.signedIn(context) }

    /** 已保存的表单内容, 不管是否登录, 供设置页回填。 */
    fun read(context: Context): AppConfig? = JsonFile.read(file(context))?.let {
        AppConfig(
            server = it.optString(KEY_SERVER),
            subscription = it.optString(KEY_SUBSCRIPTION),
            proxyLink = it.optBoolean(KEY_PROXY_LINK, true),
        )
    }?.takeIf { it.valid }

    fun save(context: Context, config: AppConfig) {
        JsonFile.write(
            file(context),
            JSONObject()
                .put(KEY_SERVER, config.server.trim())
                .put(KEY_SUBSCRIPTION, config.subscription.trim())
                .put(KEY_PROXY_LINK, config.proxyLink),
        )
    }

    private fun file(context: Context) = File(context.filesDir, FILE_NAME)
}
