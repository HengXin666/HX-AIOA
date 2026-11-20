package com.hengxin.aioa.config

import android.content.Context
import org.json.JSONObject
import java.io.File

data class AppConfig(val server: String, val token: String) {
    val valid: Boolean get() = server.isNotBlank() && token.isNotBlank()
}

// 用文件而不是 SharedPreferences: :link 进程每次连接都重新读取, 不会拿到别的进程的旧缓存
object ConfigStore {
    private const val FILE_NAME = "config.json"
    private const val TMP_SUFFIX = ".tmp"
    private const val KEY_SERVER = "server"
    private const val KEY_TOKEN = "token"

    fun load(context: Context): AppConfig? = runCatching {
        val o = JSONObject(file(context).readText())
        AppConfig(o.getString(KEY_SERVER), o.getString(KEY_TOKEN))
    }.getOrNull()?.takeIf { it.valid }

    fun save(context: Context, config: AppConfig) {
        val target = file(context)
        val tmp = File(target.parentFile, FILE_NAME + TMP_SUFFIX)
        tmp.writeText(JSONObject().put(KEY_SERVER, config.server.trim()).put(KEY_TOKEN, config.token.trim()).toString())
        tmp.renameTo(target)
    }

    private fun file(context: Context) = File(context.filesDir, FILE_NAME)
}
