package com.hengxin.aioa.config

import android.content.Context
import org.json.JSONObject
import java.io.File

// 手机无法注入键盘时用 adb push 一份 setup.json 到 App 外部目录完成首次配置, 读一次就删
// 字段: server, subscription (不含令牌, 账号仍需在 App 里登录)
object SetupImport {
    private const val FILE_NAME = "setup.json"

    fun apply(context: Context): Boolean {
        val f = File(context.getExternalFilesDir(null) ?: return false, FILE_NAME)
        if (!f.exists()) return false
        val json = runCatching { JSONObject(f.readText()) }.getOrNull()
        f.delete()
        json ?: return false
        val config = AppConfig(json.optString("server"), json.optString("subscription"))
        if (!config.valid) return false
        ConfigStore.save(context, config)
        return true
    }
}
