package com.hengxin.aioa.config

import android.content.Context
import org.json.JSONObject
import java.io.File

data class AppConfig(
    val server: String,
    val token: String,
    val subscription: String = "",
    val proxyLink: Boolean = true,
) {
    val valid: Boolean get() = server.isNotBlank() && token.isNotBlank()
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
    private const val KEY_TOKEN = "token"
    private const val KEY_SUBSCRIPTION = "subscription"
    private const val KEY_PROXY_LINK = "proxyLink"

    fun load(context: Context): AppConfig? = JsonFile.read(file(context))?.let {
        AppConfig(
            server = it.optString(KEY_SERVER),
            token = it.optString(KEY_TOKEN),
            subscription = it.optString(KEY_SUBSCRIPTION),
            proxyLink = it.optBoolean(KEY_PROXY_LINK, true),
        )
    }?.takeIf { it.valid }

    fun save(context: Context, config: AppConfig) {
        JsonFile.write(
            file(context),
            JSONObject()
                .put(KEY_SERVER, config.server.trim())
                .put(KEY_TOKEN, config.token.trim())
                .put(KEY_SUBSCRIPTION, config.subscription.trim())
                .put(KEY_PROXY_LINK, config.proxyLink),
        )
    }

    private fun file(context: Context) = File(context.filesDir, FILE_NAME)
}
