package com.hengxin.aioa.ui.settings

import android.content.Context
import androidx.compose.ui.graphics.Color
import com.hengxin.aioa.config.JsonFile
import com.hengxin.aioa.kit.ThemeOverride
import com.hengxin.aioa.net.Api
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File

/**
 * 主题插件: 默认主题内置, 启用了提供 core.theme.base 的插件时用它的颜色覆盖。
 * 上次的结果存在本地, 启动时直接用, 不等网络; 连上后与收到 plugin_update 时重拉。
 */
object PluginTheme {
    private const val FILE = "plugin-theme.json"
    private const val PATH = "api/v1/plugin-contrib/core.theme.base"
    private const val KEY_LIGHT = "light"
    private const val KEY_DARK = "dark"
    private val _flow = MutableStateFlow<ThemeOverride?>(null)
    val flow: StateFlow<ThemeOverride?> = _flow
    private var loaded = false

    private fun file(context: Context) = File(context.filesDir, FILE)

    /** 退出登录或换服务端时丢掉缓存, 免得沿用上一个账号的主题。 */
    fun clear(context: Context) {
        file(context).delete()
        _flow.value = null
    }

    /** 读本地缓存 (只读一次)。 */
    fun load(context: Context) {
        if (loaded) return
        loaded = true
        _flow.value = JsonFile.read(file(context))?.let(::parse)
    }

    /** 向服务端要本账号生效的主题; 没有主题插件就清掉覆盖。失败保持原样。 */
    suspend fun refresh(context: Context) = withContext(Dispatchers.IO) {
        val body = Api.call(context, "GET", listOf(PATH)).body ?: return@withContext
        val item = body.optJSONArray("items")?.optJSONObject(0)
        val saved = JSONObject().put(KEY_LIGHT, item?.optJSONObject(KEY_LIGHT) ?: JSONObject()).put(KEY_DARK, item?.optJSONObject(KEY_DARK) ?: JSONObject())
        JsonFile.write(file(context), saved)
        _flow.value = parse(saved)
    }

    private fun parse(o: JSONObject): ThemeOverride? {
        val light = colors(o.optJSONObject(KEY_LIGHT))
        val dark = colors(o.optJSONObject(KEY_DARK))
        return if (light.isEmpty() && dark.isEmpty()) null else ThemeOverride(light, dark)
    }

    private fun colors(o: JSONObject?): Map<String, Color> =
        o?.keys()?.asSequence()?.mapNotNull { k -> hex(o.optString(k))?.let { k to it } }?.toMap().orEmpty()

    // #RRGGBB 或 #RRGGBBAA (协议格式, 透明度在最后)
    private fun hex(s: String): Color? {
        if (!Regex("^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$").matches(s)) return null
        val rgb = s.substring(1, 7).toLong(16)
        val a = if (s.length == 9) s.substring(7, 9).toLong(16) else 0xFFL
        return Color(((a shl 24) or rgb).toInt())
    }
}
