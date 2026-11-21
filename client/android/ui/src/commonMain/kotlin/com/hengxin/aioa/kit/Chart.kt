package com.hengxin.aioa.kit

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
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

private const val DRAW_IN_MS = 600
private const val AREA_ALPHA = 0.14f

/** 一个时间点的取值, label 用于按住时的气泡 (如 "14:05")。 */
data class Point(val label: String, val value: Float)

/**
 * 折线图: 首次出现描线动画, 标出最大 / 最小值, 可选阈值虚线;
 * 按住或拖动 (鼠标同样) 显示十字线和该点数值。
 */
@Composable
fun LineChart(
    points: List<Point>,
    unit: String,
    modifier: Modifier = Modifier,
    height: Dp = 120.dp,
    threshold: Float? = null,
    showExtremes: Boolean = true,
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
                detectTapGestures(onPress = { touch = it.x; tryAwaitRelease(); touch = null })
            }
            .pointerInput(points) {
                detectDragGestures(
                    onDragStart = { touch = it.x },
                    onDragEnd = { touch = null },
                    onDragCancel = { touch = null },
                    onDrag = { change, _ -> touch = change.position.x },
                )
            },
    ) {
        val top = 14.dp.toPx()
        val bottom = size.height - 14.dp.toPx()
        val minV = minOf(points.minOf { it.value }, threshold ?: Float.MAX_VALUE)
        val maxV = maxOf(points.maxOf { it.value }, threshold ?: -Float.MAX_VALUE)
        val span = (maxV - minV).takeIf { it > 0f } ?: 1f
        fun x(i: Int) = i * size.width / (points.size - 1)
        fun y(v: Float) = bottom - (v - minV) / span * (bottom - top)

        val line = Path().apply {
            points.forEachIndexed { i, p -> if (i == 0) moveTo(x(i), y(p.value)) else lineTo(x(i), y(p.value)) }
        }
        val area = Path().apply {
            addPath(line)
            lineTo(size.width, bottom)
            lineTo(0f, bottom)
            close()
        }
        clipRect(right = size.width * progress.value) {
            drawPath(area, Brush.verticalGradient(listOf(c.accent.copy(alpha = AREA_ALPHA), c.accent.copy(alpha = 0f)), top, bottom))
            drawPath(line, c.accent, style = Stroke(2.dp.toPx(), cap = StrokeCap.Round))
        }
        threshold?.let {
            drawLine(
                c.danger, Offset(0f, y(it)), Offset(size.width, y(it)), 1.dp.toPx(),
                pathEffect = PathEffect.dashPathEffect(floatArrayOf(6f, 6f)),
            )
        }
        if (showExtremes) {
            val hi = points.indices.maxBy { points[it].value }
            val lo = points.indices.minBy { points[it].value }
            label(measurer.measure(fmt(points[hi].value) + unit, small), x(hi), y(points[hi].value) - 12.dp.toPx())
            label(measurer.measure(fmt(points[lo].value) + unit, small), x(lo), y(points[lo].value) + 2.dp.toPx())
        }
        val last = points.lastIndex
        if (progress.value >= 1f) drawCircle(c.accent, 3.dp.toPx(), Offset(x(last), y(points[last].value)))

        touch?.let { tx ->
            val i = ((tx / size.width) * last).toInt().coerceIn(0, last)
            val px = x(i)
            val py = y(points[i].value)
            drawLine(c.textSecondary.copy(alpha = 0.5f), Offset(px, 0f), Offset(px, size.height), 1.dp.toPx())
            drawCircle(c.accent, 4.dp.toPx(), Offset(px, py))
            val text = measurer.measure("${points[i].label}  ${fmt(points[i].value)}$unit", bubble)
            val pad = 6.dp.toPx()
            val w = text.size.width + pad * 2
            val h = text.size.height + pad
            val bx = (px - w / 2).coerceIn(0f, size.width - w)
            drawRoundRect(c.accent, Offset(bx, 0f), Size(w, h), androidx.compose.ui.geometry.CornerRadius(h / 2))
            drawText(text, topLeft = Offset(bx + pad, pad / 2))
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
