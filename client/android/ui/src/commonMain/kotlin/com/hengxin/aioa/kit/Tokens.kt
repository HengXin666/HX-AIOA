package com.hengxin.aioa.kit

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** 颜色令牌, 组件只引用这里的名字, 不写死色值。 */
@Immutable
data class AioaColors(
    val background: Color,
    val surface: Color,
    val surfaceAlt: Color,
    val border: Color,
    val text: Color,
    val textSecondary: Color,
    val accent: Color,
    val onAccent: Color,
    val success: Color,
    val warning: Color,
    val danger: Color,
    // 侧栏底, 浮层 (菜单) 底, 遮罩; 主题插件没给时按明暗取默认
    val sidebar: Color = background,
    val popover: Color = surface,
    val scrim: Color = Color.Black,
)

/** 尺寸令牌: 圆角, 间距, 是否紧凑。 */
@Immutable
data class AioaMetrics(
    val radius: Dp,
    val gap: Dp,
    val padding: Dp,
)

@Immutable
data class AioaTokens(val colors: AioaColors, val metrics: AioaMetrics, val dark: Boolean)

/** 用户在设置页可改的外观, 只是对默认令牌的覆盖。 */
@Immutable
data class Appearance(
    val dark: Boolean = false,
    val accent: Color? = null,
    val radius: Dp = DEFAULT_RADIUS,
    val compact: Boolean = false,
    // 主题插件 (core.theme.base) 覆盖的颜色; 没有就是默认的极简主题
    val theme: ThemeOverride? = null,
)

/** 主题插件给的颜色覆盖: 令牌名 (AioaColors 的字段名) -> 颜色, 亮暗各一份, 没写的沿用默认。 */
@Immutable
data class ThemeOverride(val light: Map<String, Color>, val dark: Map<String, Color>)

private fun AioaColors.with(o: Map<String, Color>): AioaColors {
    if (o.isEmpty()) return this
    fun c(name: String, d: Color) = o[name] ?: d
    // 只给了强调色没给字色时按亮度补, 免得浅色强调色配白字看不清
    val accent = c("accent", accent)
    val onAccent = o["onAccent"] ?: if ("accent" in o) contrastOn(accent) else onAccent
    return AioaColors(
        background = c("background", background), surface = c("surface", surface), surfaceAlt = c("surfaceAlt", surfaceAlt),
        border = c("border", border), text = c("text", text), textSecondary = c("textSecondary", textSecondary),
        accent = accent, onAccent = onAccent, success = c("success", success),
        warning = c("warning", warning), danger = c("danger", danger),
        sidebar = c("sidebar", sidebar), popover = c("popover", popover), scrim = c("scrim", scrim),
    )
}

val DEFAULT_RADIUS = 16.dp

/** 默认主题: 取锁定版本 HX-UI 的皮肤 (HxUi.SKIN, 现为 ink, ChatGPT 式), 由 HxPalette 映射到 App 的令牌名。 */
object Minimal {
    val light = HxUi.light.toAioa()
    // 深色内容是纯黑, 黑遮罩压不出层次, 取 ChatGPT 的灰 (#616161)
    val dark = HxUi.dark.toAioa().copy(scrim = Color(0xFF616161))
}

fun HxPalette.toAioa() = AioaColors(
    background = background,
    surface = muted,
    surfaceAlt = accent,
    border = border,
    text = foreground,
    textSecondary = mutedForeground,
    accent = primary,
    onAccent = primaryForeground,
    success = success,
    warning = warning,
    danger = destructive,
    sidebar = sidebar,
    popover = popover,
)

/** 由外观设置算出最终令牌。 */
fun tokensOf(a: Appearance): AioaTokens {
    val default = if (a.dark) Minimal.dark else Minimal.light
    // 顺序: 默认主题 -> 主题插件 -> 用户自己选的强调色
    val base = a.theme?.let { default.with(if (a.dark) it.dark else it.light) } ?: default
    val colors = a.accent?.let { base.copy(accent = it, onAccent = contrastOn(it)) } ?: base
    val metrics = if (a.compact) {
        AioaMetrics(radius = a.radius, gap = 8.dp, padding = 12.dp)
    } else {
        AioaMetrics(radius = a.radius, gap = 12.dp, padding = 16.dp)
    }
    return AioaTokens(colors, metrics, a.dark)
}

/** 按亮度选黑或白作为强调色上的文字色。 */
fun contrastOn(c: Color): Color {
    val luminance = 0.2126f * c.red + 0.7152f * c.green + 0.0722f * c.blue
    return if (luminance > 0.55f) Color(0xFF0D0D0D) else Color(0xFFFFFFFF)
}

val LocalTokens = staticCompositionLocalOf { tokensOf(Appearance()) }

object Aioa {
    val tokens: AioaTokens @Composable get() = LocalTokens.current
    val colors: AioaColors @Composable get() = LocalTokens.current.colors
    val metrics: AioaMetrics @Composable get() = LocalTokens.current.metrics
}

@Composable
fun AioaTheme(appearance: Appearance, content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalTokens provides tokensOf(appearance), content = content)
}
