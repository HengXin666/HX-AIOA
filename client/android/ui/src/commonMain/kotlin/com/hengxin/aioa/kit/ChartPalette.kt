package com.hengxin.aioa.kit

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.luminance

// 图表调色板 (#142): 色值全部来自 HX-UI 令牌 (HxUi 浅 / 深) 与当前主题令牌 (AioaColors),
// 这里只做两件事: 按语义挑色, 按底色把对比度补到 3:1 (WCAG 非文字图形)。不写任何色值。

/** 图形与底色的最低对比度。 */
const val CHART_MIN_CONTRAST = 3f
private const val FIX_STEP = 0.05f
private const val FIX_MAX = 0.6f
private const val CHROMA_MIN = 0.12f

/** 热力格 1..4 级在空格色与主色之间的位置 (0 级是空格)。 */
private val HEAT_STOPS = floatArrayOf(0.34f, 0.56f, 0.78f, 1f)

/**
 * 一套图表色, 浅色深色各算一份。
 * primary 主系列; accent 第二系列; success / warning / danger 语义; neutral 次要 / 其他;
 * series 多系列按序取, 相邻两色色相拉开; heat 热力格单色阶 (0 = 空格, 1..4 = 主色由浅到深)。
 */
@Immutable
data class ChartPalette(
    val primary: Color,
    val accent: Color,
    val success: Color,
    val warning: Color,
    val danger: Color,
    val neutral: Color,
    val teal: Color,
    val amber: Color,
    val green: Color,
    val series: List<Color>,
    val heat: List<Color>,
    val grid: Color,
    val axis: Color,
    val track: Color,
    val dark: Boolean,
) {
    /** 第 i 个系列的颜色, 超出时循环。 */
    fun of(i: Int): Color = series[((i % series.size) + series.size) % series.size]

    /** 热力格第 level 级 (0..4)。 */
    fun heatOf(level: Int): Color = heat[level.coerceIn(0, heat.lastIndex)]

    /** 柱子, 面积这类大块填充: 同色降透明度, 不另起颜色。 */
    fun fill(c: Color, strong: Boolean = false): Color = c.copy(alpha = if (strong) 0.85f else if (dark) 0.5f else 0.4f)
}

/** 当前主题下的图表调色板。 */
@Composable
fun chartPalette(): ChartPalette {
    val t = Aioa.tokens
    return remember(t) { chartPaletteOf(t.colors, t.dark) }
}

/**
 * 由主题令牌算调色板: 主色 = 主题强调色 (用户选了彩色时) 否则 HX-UI info;
 * 第二系列 = HX-UI chart4; 青 / 琥珀 / 绿 = HX-UI chart2 / chart3 / chart5; 语义色取主题令牌。
 */
fun chartPaletteOf(c: AioaColors, dark: Boolean): ChartPalette {
    val hx = if (dark) HxUi.dark else HxUi.light
    // 最不利的底: 浅色取更暗的那层 (卡片底), 深色取更亮的那层
    val bgs = listOf(c.background, c.surface)
    fun fix(x: Color) = ensureContrast(x, bgs, dark)
    val primary = fix(if (chroma(c.accent) >= CHROMA_MIN) c.accent else hx.info)
    val accent = fix(hx.chart4)
    val teal = fix(hx.chart2)
    val amber = fix(hx.chart3)
    val green = fix(hx.chart5)
    val success = fix(c.success)
    val warning = fix(c.warning)
    val danger = fix(c.danger)
    val neutral = fix(c.textSecondary)
    val track = c.surfaceAlt
    // 顺序: 蓝, 琥珀, 青, 品红, 绿, 灰, 红 (红绿不相邻, 冷暖交替)
    val series = listOf(primary, amber, teal, accent, green, neutral, danger)
    val heat = listOf(track) + (1..HEAT_STOPS.size).map { heatTint(track, primary, it) }
    return ChartPalette(
        primary = primary, accent = accent, success = success, warning = warning, danger = danger, neutral = neutral,
        teal = teal, amber = amber, green = green, series = series, heat = heat,
        grid = c.border, axis = c.textSecondary, track = track, dark = dark,
    )
}

/** 热力格第 level 级 (1..4) 的实色: 从空格色 base 往 color 按级混合, 不用透明度 (渐变底上也不串色, 深色下 1 级也比空格亮)。 */
fun heatTint(base: Color, color: Color, level: Int): Color =
    lerp(base, color, HEAT_STOPS[(level - 1).coerceIn(0, HEAT_STOPS.lastIndex)])

/** 两色对比度 (WCAG 相对亮度)。 */
fun contrastOf(a: Color, b: Color): Float {
    val la = a.luminance()
    val lb = b.luminance()
    return (maxOf(la, lb) + 0.05f) / (minOf(la, lb) + 0.05f)
}

/** 对比度不够时往远离底色的方向 (浅色变暗, 深色变亮) 一点点混, 色相不变。 */
fun ensureContrast(x: Color, bgs: List<Color>, dark: Boolean, min: Float = CHART_MIN_CONTRAST): Color {
    val toward = if (dark) Color.White else Color.Black
    var k = 0f
    var out = x
    while (bgs.minOf { contrastOf(out, it) } < min && k < FIX_MAX) {
        k += FIX_STEP
        out = lerp(x, toward, k)
    }
    return out
}

/** 粗略彩度: 最大与最小分量之差; 黑白灰接近 0。 */
private fun chroma(c: Color): Float = maxOf(c.red, c.green, c.blue) - minOf(c.red, c.green, c.blue)
