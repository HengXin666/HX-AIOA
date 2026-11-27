package com.hengxin.aioa.kit

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt

// 总览用的图表与动效: 只用 HX-UI 的语义色与图表色, 不写死色值

private const val STAGGER_MS = 70
private const val ENTER_MS = 520
private const val DRAW_MS = 1100

/** 当前明暗对应的 HX-UI 色板 (图表色 chart1..5 从这里取)。 */
@Composable
fun hxPalette(): HxPalette = if (Aioa.tokens.dark) HxUi.dark else HxUi.light

/** 首次出现时 0 到 1 的进度。 */
@Composable
fun rememberReveal(delayMs: Int = 0, durationMs: Int = DRAW_MS): Float {
    val a = remember { Animatable(0f) }
    LaunchedEffect(Unit) { a.animateTo(1f, tween(durationMs, delayMillis = delayMs, easing = FastOutSlowInEasing)) }
    return a.value
}

/** 入场: 按序号错开, 淡入并上移。 */
fun Modifier.enter(index: Int): Modifier = composed {
    val p = rememberReveal(index * STAGGER_MS, ENTER_MS)
    graphicsLayer { alpha = p; translationY = (1f - p) * 24.dp.toPx() }
}

/** 数字从 0 滚到目标值。 */
@Composable
fun CountUp(target: Int, sizeSp: Int, color: Color, modifier: Modifier = Modifier, delayMs: Int = 0, suffix: String = "") {
    val p = rememberReveal(delayMs, 900)
    Text("${(target * p).roundToInt()}$suffix", color, sizeSp, modifier, weight = FontWeight.SemiBold)
}

/** 实时小点: 实心点外一圈呼吸的光晕。 */
@Composable
fun LiveDot(color: Color, dot: Dp = 8.dp) {
    val t = rememberInfiniteTransition()
    val k by t.animateFloat(0f, 1f, infiniteRepeatable(tween(1400, easing = LinearEasing)))
    Canvas(Modifier.size(dot * 2.5f)) {
        val r = dot.toPx() / 2
        drawCircle(color.copy(alpha = 0.35f * (1f - k)), radius = r + r * 1.4f * k)
        drawCircle(color, r)
    }
}

/** 面板: 比分组卡更 "重" 一级, 上亮下暗的细渐变 + 描边。 */
@Composable
fun Panel(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    val c = Aioa.colors
    val shape = RoundedCornerShape(20.dp)
    val bg = if (Aioa.tokens.dark) listOf(c.surface, c.sidebar) else listOf(c.background, c.popover)
    Column(
        modifier.clip(shape).background(Brush.verticalGradient(bg)).border(1.dp, c.border.copy(alpha = 0.7f), shape),
        content = content,
    )
}

private fun smooth(path: Path, pts: List<Offset>) {
    path.moveTo(pts[0].x, pts[0].y)
    for (i in 1 until pts.size) {
        val a = pts[i - 1]
        val b = pts[i]
        val mid = (a.x + b.x) / 2
        path.cubicTo(mid, a.y, mid, b.y, b.x, b.y)
    }
}

/** 面积图: 平滑曲线 + 由上到下渐隐的填充, 出现时从左往右描出来, 末端一个亮点。 */
@Composable
fun AreaChart(values: List<Float>, color: Color, modifier: Modifier = Modifier, delayMs: Int = 0, grid: Boolean = true) {
    if (values.size < 2) return
    val p = rememberReveal(delayMs)
    val line = Aioa.colors.border
    Canvas(modifier) {
        val mx = values.max().takeIf { it > 0f } ?: 1f
        val top = 8.dp.toPx()
        val right = size.width - 8.dp.toPx()
        val h = size.height - top
        val pts = values.mapIndexed { i, v -> Offset(i * right / (values.size - 1), top + h - v / mx * h * 0.9f) }
        if (grid) {
            val dash = PathEffect.dashPathEffect(floatArrayOf(3.dp.toPx(), 4.dp.toPx()))
            for (k in 1..3) {
                val y = size.height * k / 4
                drawLine(line.copy(alpha = 0.6f), Offset(0f, y), Offset(size.width, y), 1f, pathEffect = dash)
            }
        }
        val stroke = Path().also { smooth(it, pts) }
        val fill = Path().also {
            smooth(it, pts)
            it.lineTo(pts.last().x, size.height)
            it.lineTo(0f, size.height)
            it.close()
        }
        clipRect(right = size.width * p) {
            drawPath(fill, Brush.verticalGradient(listOf(color.copy(alpha = 0.3f), color.copy(alpha = 0f)), startY = top, endY = size.height))
            drawPath(stroke, color, style = Stroke(2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
        }
        if (p >= 0.99f) {
            drawCircle(color.copy(alpha = 0.25f), 7.dp.toPx(), pts.last())
            drawCircle(color, 3.5.dp.toPx(), pts.last())
        }
    }
}

/** 进度环 (图表, 不是按钮), 中间放内容。 */
@Composable
fun Ring(fraction: Float, color: Color, modifier: Modifier = Modifier, stroke: Dp = 5.dp, delayMs: Int = 0, content: @Composable () -> Unit = {}) {
    val p = rememberReveal(delayMs)
    val track = Aioa.colors.surfaceAlt
    Box(modifier, contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val s = stroke.toPx()
            val o = Offset(s / 2, s / 2)
            val sz = Size(size.width - s, size.height - s)
            drawArc(track, 0f, 360f, false, o, sz, style = Stroke(s))
            drawArc(color, -90f, 360f * fraction * p, false, o, sz, style = Stroke(s, cap = StrokeCap.Round))
        }
        content()
    }
}

/** 热力格 (GitHub 贡献图那种), 按列从左往右亮起来。levels 每格 0..4, 按列填。 */
@Composable
fun Heatmap(levels: List<Int>, rows: Int, color: Color, modifier: Modifier = Modifier, delayMs: Int = 0) {
    val p = rememberReveal(delayMs)
    val empty = Aioa.colors.surfaceAlt
    Canvas(modifier) {
        val cols = (levels.size + rows - 1) / rows
        val gap = 3.dp.toPx()
        val cell = minOf((size.width - gap * (cols - 1)) / cols, (size.height - gap * (rows - 1)) / rows)
        val r = CornerRadius(3.dp.toPx())
        levels.forEachIndexed { i, lv ->
            val col = i / rows
            val shown = col.toFloat() / cols <= p
            val tint = if (lv == 0 || !shown) empty else color.copy(alpha = 0.25f + 0.75f * lv / 4f)
            drawRoundRect(tint, Offset(col * (cell + gap), (i % rows) * (cell + gap)), Size(cell, cell), r)
        }
    }
}

/** 分段条: 负载, 容量这类百分比。 */
@Composable
fun Meter(fraction: Float, color: Color, modifier: Modifier = Modifier, segments: Int = 24, delayMs: Int = 0) {
    val p = rememberReveal(delayMs, 900)
    val empty = Aioa.colors.surfaceAlt
    Canvas(modifier) {
        val gap = 2.dp.toPx()
        val w = (size.width - gap * (segments - 1)) / segments
        val on = fraction * p * segments
        val r = CornerRadius(1.5.dp.toPx())
        for (i in 0 until segments) drawRoundRect(if (i < on) color else empty, Offset(i * (w + gap), 0f), Size(w, size.height), r)
    }
}
