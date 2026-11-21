package com.hengxin.aioa.kit

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.PointerType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private const val DRAW_IN_MS = 600
private const val AREA_ALPHA = 0.14f
private const val Y_TICKS = 3
private val AXIS_GAP = 6.dp
private val X_TICK_SPACING = 72.dp

/** 一个时间点的取值, label 用于按住时的气泡 (如 "14:05")。 */
data class Point(val label: String, val value: Float)

/**
 * 折线图: 左侧 Y 轴刻度 + 网格线, 底部 X 轴时间刻度, 首次出现描线动画, 标出最大 / 最小值, 可选阈值虚线。
 * 鼠标悬停, 手指按住或拖动显示十字线和该点数值; pinned 固定显示某个点 (截图和教学用)。
 */
@Composable
fun LineChart(
    points: List<Point>,
    unit: String,
    modifier: Modifier = Modifier,
    height: Dp = 160.dp,
    threshold: Float? = null,
    showExtremes: Boolean = true,
    pinned: Int? = null,
) {
    if (points.size < 2) return
    val c = Aioa.colors
    val measurer = rememberTextMeasurer()
    val progress = remember { Animatable(0f) }
    LaunchedEffect(Unit) { progress.animateTo(1f, tween(DRAW_IN_MS)) }
    var touch by remember { mutableStateOf<Float?>(null) }
    val small = TextStyle(color = c.textSecondary, fontSize = 10.sp)
    val bubble = TextStyle(color = c.onAccent, fontSize = 11.sp)

    Canvas(
        modifier.fillMaxWidth().height(height)
            .pointerInput(points) {
                awaitPointerEventScope {
                    while (true) {
                        val e = awaitPointerEvent()
                        val mouse = e.changes.first().type == PointerType.Mouse
                        when (e.type) {
                            PointerEventType.Move -> if (mouse || e.changes.first().pressed) touch = e.changes.first().position.x
                            PointerEventType.Press -> touch = e.changes.first().position.x
                            PointerEventType.Release -> if (!mouse) touch = null
                            PointerEventType.Exit -> touch = null
                        }
                    }
                }
            },
    ) {
        val yTexts = measurer.measure(fmt(maxOf(points.maxOf { it.value }, threshold ?: -Float.MAX_VALUE)), small)
        val left = yTexts.size.width + AXIS_GAP.toPx()
        val top = 14.dp.toPx()
        val bottom = size.height - yTexts.size.height - AXIS_GAP.toPx()
        val w = size.width - left
        val minV = minOf(points.minOf { it.value }, threshold ?: Float.MAX_VALUE)
        val maxV = maxOf(points.maxOf { it.value }, threshold ?: -Float.MAX_VALUE)
        val span = (maxV - minV).takeIf { it > 0f } ?: 1f
        val last = points.lastIndex
        fun x(i: Int) = left + i * w / last
        fun y(v: Float) = bottom - (v - minV) / span * (bottom - top)

        for (k in 0 until Y_TICKS) {
            val v = minV + span * k / (Y_TICKS - 1)
            drawLine(c.border, Offset(left, y(v)), Offset(size.width, y(v)), 1f)
            val t = measurer.measure(fmt(v), small)
            drawText(t, topLeft = Offset(left - AXIS_GAP.toPx() - t.size.width, y(v) - t.size.height / 2))
        }
        val xTicks = (w / X_TICK_SPACING.toPx()).toInt().coerceIn(2, points.size)
        for (k in 0 until xTicks) {
            val i = k * last / (xTicks - 1)
            val t = measurer.measure(points[i].label, small)
            val tx = (x(i) - t.size.width / 2).coerceIn(left, size.width - t.size.width)
            drawText(t, topLeft = Offset(tx, bottom + AXIS_GAP.toPx()))
        }

        val line = Path().apply {
            points.forEachIndexed { i, p -> if (i == 0) moveTo(x(i), y(p.value)) else lineTo(x(i), y(p.value)) }
        }
        val area = Path().apply {
            addPath(line)
            lineTo(size.width, bottom)
            lineTo(left, bottom)
            close()
        }
        clipRect(left = left, right = left + w * progress.value) {
            drawPath(area, Brush.verticalGradient(listOf(c.accent.copy(alpha = AREA_ALPHA), c.accent.copy(alpha = 0f)), top, bottom))
            drawPath(line, c.accent, style = Stroke(2.dp.toPx(), cap = StrokeCap.Round))
        }
        threshold?.let {
            drawLine(
                c.danger, Offset(left, y(it)), Offset(size.width, y(it)), 1.dp.toPx(),
                pathEffect = PathEffect.dashPathEffect(floatArrayOf(6f, 6f)),
            )
        }
        val active = touch?.let { (((it - left) / w) * last + 0.5f).toInt().coerceIn(0, last) } ?: pinned
        if (showExtremes && active == null) {
            val hi = points.indices.maxBy { points[it].value }
            val lo = points.indices.minBy { points[it].value }
            label(measurer.measure(fmt(points[hi].value) + unit, small), x(hi), y(points[hi].value) - 14.dp.toPx())
            label(measurer.measure(fmt(points[lo].value) + unit, small), x(lo), y(points[lo].value) + 3.dp.toPx())
        }
        if (progress.value >= 1f) drawCircle(c.accent, 3.dp.toPx(), Offset(x(last), y(points[last].value)))

        active?.let { i ->
            val px = x(i)
            val py = y(points[i].value)
            drawLine(c.textSecondary.copy(alpha = 0.5f), Offset(px, top), Offset(px, bottom), 1.dp.toPx())
            drawLine(c.textSecondary.copy(alpha = 0.3f), Offset(left, py), Offset(size.width, py), 1.dp.toPx())
            drawCircle(c.background, 6.dp.toPx(), Offset(px, py))
            drawCircle(c.accent, 4.dp.toPx(), Offset(px, py))
            val text = measurer.measure("${points[i].label}  ${fmt(points[i].value)}$unit", bubble)
            val pad = 6.dp.toPx()
            val bw = text.size.width + pad * 2
            val bh = text.size.height + pad
            val bx = (px - bw / 2).coerceIn(left, size.width - bw)
            val by = (py - bh - 10.dp.toPx()).let { if (it < 0f) py + 10.dp.toPx() else it }
            drawRoundRect(c.accent, Offset(bx, by), Size(bw, bh), CornerRadius(bh / 2))
            drawText(text, topLeft = Offset(bx + pad, by + pad / 2))
        }
    }
}

private fun DrawScope.label(t: androidx.compose.ui.text.TextLayoutResult, cx: Float, y: Float) {
    val x = (cx - t.size.width / 2).coerceIn(0f, size.width - t.size.width)
    drawText(t, topLeft = Offset(x, y.coerceIn(0f, size.height - t.size.height)))
}

/** 迷你折线, 用于数值卡右侧, 不显示坐标。 */
@Composable
fun Sparkline(values: List<Float>, modifier: Modifier = Modifier) {
    if (values.size < 2) return
    val c = Aioa.colors
    Canvas(modifier) {
        val mn = values.min()
        val span = (values.max() - mn).takeIf { it > 0f } ?: 1f
        val p = Path()
        values.forEachIndexed { i, v ->
            val px = i * size.width / (values.size - 1)
            val py = size.height - (v - mn) / span * size.height
            if (i == 0) p.moveTo(px, py) else p.lineTo(px, py)
        }
        drawPath(p, c.accent, style = Stroke(1.5.dp.toPx(), cap = StrokeCap.Round))
    }
}

/** 数值格式: 整数不带小数, 否则保留一位。 */
fun fmt(v: Float): String {
    val r = kotlin.math.round(v * 10f) / 10f
    return if (r == r.toInt().toFloat()) r.toInt().toString() else r.toString()
}
