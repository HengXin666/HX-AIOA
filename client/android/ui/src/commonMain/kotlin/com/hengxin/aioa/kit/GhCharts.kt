package com.hengxin.aioa.kit

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// GitHub 走势用的混合图 (#142): 同一坐标里按系列选样式 (面积 / 实线 / 虚线 / 柱 / 点), 颜色由调用方从调色板取

/** 系列样式: 面积折线, 实线, 虚线, 柱 (多个柱系列并排), 点标记 (0 不画)。 */
enum class MixStyle { AREA, LINE, DASHED, BARS, DOTS }

data class MixSeries(val label: String, val values: List<Float>, val color: Color, val style: MixStyle)

private const val GRID_LINES = 3
private const val BAR_SHARE = 0.62f
private const val AREA_TOP_ALPHA = 0.28f
private const val DRAW_MS = 700
private const val X_TICKS = 4

/** y 轴上限取 "好看" 的数: (1, 2, 4, 6, 8, 10) × 10^k, 至少 2, 中线也是整数。 */
fun mixCeil(v: Float): Float {
    if (v <= 2f) return 2f
    var step = 1f
    while (v > step * 10f) step *= 10f
    return NICE.first { it * step >= v } * step
}

private val NICE = listOf(1f, 2f, 4f, 6f, 8f, 10f)

/**
 * 混合图: 左侧刻度, 底部日期; 点按或横向拖动选中一格 (onSelect), 选中格画竖线。
 * labels 与每个系列的 values 一样长。
 */
@Composable
fun MixChart(
    series: List<MixSeries>,
    labels: List<String>,
    modifier: Modifier = Modifier,
    height: Dp = 132.dp,
    selected: Int = -1,
    grid: Color = Aioa.colors.border,
    axis: Color = Aioa.colors.textSecondary,
    onSelect: (Int) -> Unit = {},
) {
    val n = labels.size
    if (n == 0 || series.isEmpty()) return
    val measurer = rememberTextMeasurer()
    val reveal = remember(series.map { it.label }, n) { Animatable(0f) }
    LaunchedEffect(reveal) { reveal.animateTo(1f, tween(DRAW_MS, easing = FastOutSlowInEasing)) }
    val small = TextStyle(color = axis, fontSize = 10.sp)
    val bg = Aioa.colors.surface
    // 画的时候记下格宽与左边距, 手势按它换算格子; 回调取最新的
    val geo = remember { FloatArray(2) { 1f } }
    val select by rememberUpdatedState(onSelect)
    fun pick(x: Float) = select(((x - geo[1]) / geo[0]).toInt().coerceIn(0, n - 1))
    Canvas(
        modifier.fillMaxWidth().height(height)
            .pointerInput(n) { detectTapGestures { pick(it.x) } }
            .pointerInput(n) { detectHorizontalDragGestures { ch, _ -> pick(ch.position.x) } },
    ) {
        val top = mixCeil(series.maxOf { s -> s.values.maxOrNull() ?: 0f })
        val topText = measurer.measure(fmt(top), small)
        val left = topText.size.width + 6.dp.toPx()
        val bottom = size.height - topText.size.height - 4.dp.toPx()
        val plotTop = topText.size.height / 2f
        val slot = (size.width - left) / n
        geo[0] = slot
        geo[1] = left
        fun x(i: Int) = left + slot * (i + 0.5f)
        fun y(v: Float) = bottom - v / top * (bottom - plotTop)
        val dash = PathEffect.dashPathEffect(floatArrayOf(3.dp.toPx(), 4.dp.toPx()))
        for (k in 0 until GRID_LINES) {
            val v = top * k / (GRID_LINES - 1)
            drawLine(grid.copy(alpha = 0.7f), Offset(left, y(v)), Offset(size.width, y(v)), 1f, pathEffect = if (k == 0) null else dash)
            val t = measurer.measure(fmt(v), small)
            drawText(t, topLeft = Offset(left - 6.dp.toPx() - t.size.width, y(v) - t.size.height / 2f))
        }
        val ticks = minOf(X_TICKS, n)
        for (k in 0 until ticks) {
            val i = if (ticks == 1) 0 else k * (n - 1) / (ticks - 1)
            val t = measurer.measure(labels[i], small)
            drawText(t, topLeft = Offset((x(i) - t.size.width / 2f).coerceIn(left, size.width - t.size.width), bottom + 4.dp.toPx()))
        }
        if (selected in 0 until n) drawLine(axis.copy(alpha = 0.45f), Offset(x(selected), plotTop), Offset(x(selected), bottom), 1.dp.toPx())
        val bars = series.filter { it.style == MixStyle.BARS }
        val barW = slot * BAR_SHARE / maxOf(1, bars.size)
        val p = reveal.value
        // 柱在最下层, 再画面积与线, 点在最上
        bars.forEachIndexed { b, s ->
            s.values.forEachIndexed { i, v ->
                if (v <= 0f) return@forEachIndexed
                val bx = x(i) - slot * BAR_SHARE / 2f + b * barW
                val h = (bottom - y(v)) * p
                drawRoundRect(s.color.copy(alpha = if (i == selected) 1f else 0.78f), Offset(bx + barW * 0.1f, bottom - h), Size(barW * 0.8f, h), CornerRadius(2.dp.toPx()))
            }
        }
        clipRect(right = left + (size.width - left) * p) {
            for (s in series) when (s.style) {
                MixStyle.AREA -> {
                    val line = path(s.values, ::x, ::y)
                    val fill = Path().apply { addPath(line); lineTo(x(s.values.lastIndex), bottom); lineTo(x(0), bottom); close() }
                    drawPath(fill, Brush.verticalGradient(listOf(s.color.copy(alpha = AREA_TOP_ALPHA), s.color.copy(alpha = 0f)), plotTop, bottom))
                    drawPath(line, s.color, style = Stroke(2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
                }
                MixStyle.LINE -> drawPath(path(s.values, ::x, ::y), s.color, style = Stroke(2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
                MixStyle.DASHED -> drawPath(path(s.values, ::x, ::y), s.color, style = Stroke(1.6.dp.toPx(), cap = StrokeCap.Round, pathEffect = PathEffect.dashPathEffect(floatArrayOf(5.dp.toPx(), 4.dp.toPx()))))
                else -> Unit
            }
        }
        for (s in series.filter { it.style == MixStyle.DOTS }) s.values.forEachIndexed { i, v ->
            if (v > 0f && p >= 1f) dot(s.color, bg, Offset(x(i), y(v)), if (i == selected) 4.5.dp.toPx() else 3.5.dp.toPx())
        }
        if (selected in 0 until n && p >= 1f) for (s in series) if (s.style == MixStyle.LINE || s.style == MixStyle.AREA || s.style == MixStyle.DASHED) {
            s.values.getOrNull(selected)?.let { dot(s.color, bg, Offset(x(selected), y(it)), 3.5.dp.toPx()) }
        }
    }
}

private fun path(values: List<Float>, x: (Int) -> Float, y: (Float) -> Float): Path = Path().apply {
    values.forEachIndexed { i, v -> if (i == 0) moveTo(x(i), y(v)) else lineTo(x(i), y(v)) }
}

private fun DrawScope.dot(color: Color, ring: Color, at: Offset, r: Float) {
    drawCircle(ring, r + 1.5.dp.toPx(), at)
    drawCircle(color, r, at)
}

/** 图例: 每个系列一个样式小样 + 名字 + 可选的数。 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun MixLegend(series: List<MixSeries>, values: List<String> = emptyList(), modifier: Modifier = Modifier) {
    val c = Aioa.colors
    FlowRow(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        series.forEachIndexed { i, s ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                Canvas(Modifier.size(16.dp, 10.dp)) { swatch(s, c.surface) }
                Text(s.label + (values.getOrNull(i)?.let { " $it" } ?: ""), c.textSecondary, 12)
            }
        }
    }
}

private fun DrawScope.swatch(s: MixSeries, ring: Color) {
    val mid = size.height / 2f
    when (s.style) {
        MixStyle.AREA -> {
            drawRect(s.color.copy(alpha = AREA_TOP_ALPHA), Offset(0f, mid), Size(size.width, mid))
            drawLine(s.color, Offset(0f, mid), Offset(size.width, mid), 2.dp.toPx())
        }
        MixStyle.LINE -> drawLine(s.color, Offset(0f, mid), Offset(size.width, mid), 2.dp.toPx(), StrokeCap.Round)
        MixStyle.DASHED -> drawLine(s.color, Offset(0f, mid), Offset(size.width, mid), 1.6.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 3.dp.toPx())))
        MixStyle.BARS -> drawRect(s.color, Offset(size.width * 0.3f, 0f), Size(size.width * 0.4f, size.height))
        MixStyle.DOTS -> dot(s.color, ring, Offset(size.width / 2f, mid), 3.dp.toPx())
    }
}
