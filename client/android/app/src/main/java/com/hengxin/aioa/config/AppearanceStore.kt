package com.hengxin.aioa.config

import android.content.Context
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Appearance
import com.hengxin.aioa.kit.DEFAULT_RADIUS
import org.json.JSONObject
import java.io.File

enum class ThemeMode(val label: String) { SYSTEM("跟随系统"), LIGHT("浅色"), DARK("深色") }

/** 用户的外观设置, 只存相对默认值的覆盖。 */
data class AppearancePrefs(
    val mode: ThemeMode = ThemeMode.SYSTEM,
    val accent: Int? = null,
    val radius: Int = DEFAULT_RADIUS.value.toInt(),
    val compact: Boolean = false,
) {
    fun resolve(systemDark: Boolean) = Appearance(
        dark = when (mode) {
            ThemeMode.SYSTEM -> systemDark
            ThemeMode.LIGHT -> false
            ThemeMode.DARK -> true
        },
        accent = accent?.let { Color(it) },
        radius = radius.dp,
        compact = compact,
    )

    fun with(a: Appearance) = copy(accent = a.accent?.toArgb(), radius = a.radius.value.toInt(), compact = a.compact)
}

object AppearanceStore {
    private const val FILE_NAME = "appearance.json"
    private const val KEY_MODE = "mode"
    private const val KEY_ACCENT = "accent"
    private const val KEY_RADIUS = "radius"
    private const val KEY_COMPACT = "compact"

    fun load(context: Context): AppearancePrefs {
        val o = JsonFile.read(file(context)) ?: return AppearancePrefs()
        val d = AppearancePrefs()
        return AppearancePrefs(
            mode = ThemeMode.entries.firstOrNull { it.name == o.optString(KEY_MODE) } ?: d.mode,
            accent = if (o.has(KEY_ACCENT)) o.getInt(KEY_ACCENT) else null,
            radius = o.optInt(KEY_RADIUS, d.radius),
            compact = o.optBoolean(KEY_COMPACT, d.compact),
        )
    }

    fun save(context: Context, p: AppearancePrefs) {
        val o = JSONObject().put(KEY_MODE, p.mode.name).put(KEY_RADIUS, p.radius).put(KEY_COMPACT, p.compact)
        p.accent?.let { o.put(KEY_ACCENT, it) }
        JsonFile.write(file(context), o)
    }

    private fun file(context: Context) = File(context.filesDir, FILE_NAME)
}
