package com.hengxin.aioa.kit

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.PointerType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// 混合图 (#142): GitHub Insights 式的折线 + 柱 + 点, 颜色由调用方从 chartPalette() 取

private const val BAR_SHARE = 0.55f
private const val BAR_WIDTH = 0.56f
private const val AREA_TOP_ALPHA = 0.22f
private const val GRID_LINES = 3
private const val DEFAULT_TICKS = 5
private val NICE = listOf(1f, 1.5f, 2f, 3f, 4f, 5f, 6f, 8f, 10f)
private val TOP_PAD = 18.dp
private val AXIS_GAP = 6.dp

/** 系列的画法: 线, 带渐隐填充的线, 柱。 */
enum class ComboKind { LINE, AREA, BAR }

/** 一个系列; values 可以比 X 轴格子少 (后面的格子是未来, 留空)。 */
data class ComboSeries(val name: String, val values: List<Float>, val color: Color, val kind: ComboKind = ComboKind.LINE)

/**
 * 混合图: 线 / 面积共用左轴; 柱子按柱子自己的最大值只占下半截 (量级不同也看得清), 具体数看气泡。
 * labels 是 X 轴全部格子 (如 0..23 时或周一到周日), ticks 是要写出来的格子序号 (默认均匀取 5 个);
 * marker 标一格 (如峰值): 在该格线的最高处画点, 旁边写 markerText; 按住 / 悬停显示这一格每个系列的数。
 */
@Composable
fun ComboChart(
    labels: List<String>,
    series: List<ComboSeries>,
    modifier: Modifier = Modifier,
    height: Dp = 168.dp,
    marker: Int? = null,
    markerText: String? = null,
    markerColor: Color? = null,
    ticks: List<Int>? = null,
    delayMs: Int = 0,
) {
    val n = labels.size
    if (n == 0) return
    val c = Aioa.colors
    val pal = chartPalette()
    val dot = markerColor ?: pal.warning
    val p = rememberReveal(delayMs, 900)
    val measurer = rememberTextMeasurer()
    var touch by remember { mutableStateOf<Float?>(null) }
    val small = TextStyle(color = pal.axis, fontSize = 10.sp)
    val lines = series.filter { it.kind != ComboKind.BAR }
    val bars = series.filter { it.kind == ComboKind.BAR }
    val shownTicks = ticks ?: if (n <= DEFAULT_TICKS) labels.indices.toList() else List(DEFAULT_TICKS) { it * (n - 1) / (DEFAULT_TICKS - 1) }

    Canvas(
        modifier.fillMaxWidth().height(height).pointerInput(n) {
            awaitPointerEventScope {
                while (true) {
                    val e = awaitPointerEvent()
                    val ch = e.changes.first()
                    val mouse = ch.type == PointerType.Mouse
                    when (e.type) {
                        PointerEventType.Move -> if (mouse || ch.pressed) touch = ch.position.x
                        PointerEventType.Press -> touch = ch.position.x
                        PointerEventType.Release -> if (!mouse) touch = null
                        PointerEventType.Exit -> touch = null
                    }
                }
            }
        },
    ) {
        val lineMax = (lines.flatMap { it.values }.maxOrNull() ?: 0f).coerceAtLeast(1f)
        val niceMax = niceCeil(lineMax)
        val yText = measurer.measure(fmt(niceMax), small)
        val left = yText.size.width + AXIS_GAP.toPx()
        val top = TOP_PAD.toPx()
        val bottom = size.height - yText.size.height - AXIS_GAP.toPx()
        val plotH = bottom - top
        val slot = (size.width - left) / n
        fun x(i: Int) = left + slot * (i + 0.5f)
        fun y(v: Float) = bottom - v / niceMax * plotH

        val dash = PathEffect.dashPathEffect(floatArrayOf(3.dp.toPx(), 4.dp.toPx()))
        for (k in 0..GRID_LINES) {
            val v = niceMax * k / GRID_LINES
            drawLine(pal.grid.copy(alpha = if (k == 0) 1f else 0.7f), Offset(left, y(v)), Offset(size.width, y(v)), 1f, pathEffect = if (k == 0) null else dash)
            if (k == 0 || k == GRID_LINES) {
                val t = measurer.measure(fmt(v), small)
                drawText(t, topLeft = Offset(left - AXIS_GAP.toPx() - t.size.width, y(v) - t.size.height / 2))
            }
        }
        shownTicks.filter { it in 0 until n }.forEach { i ->
            val t = measurer.measure(labels[i], small)
            drawText(t, topLeft = Offset((x(i) - t.size.width / 2).coerceIn(left, size.width - t.size.width), bottom + AXIS_GAP.toPx()))
        }

        clipRect(left = 0f, right = left + (size.width - left) * p) {
            // 柱: 每个柱系列一组并排, 各按自己的最大值
            val bw = slot * BAR_WIDTH / bars.size.coerceAtLeast(1)
            bars.forEachIndexed { b, s ->
                val mx = (s.values.maxOrNull() ?: 0f).coerceAtLeast(1f)
                s.values.forEachIndexed { i, v ->
                    if (v <= 0f) return@forEachIndexed
                    val h = v / mx * plotH * BAR_SHARE
                    val bx = x(i) - slot * BAR_WIDTH / 2 + b * bw
                    drawRoundRect(pal.fill(s.color), Offset(bx, bottom - h), Size(bw, h), CornerRadius(minOf(bw / 2, 3.dp.toPx())))
                }
            }
            lines.forEach { s ->
                if (s.values.isEmpty()) return@forEach
                val pts = s.values.mapIndexed { i, v -> Offset(x(i), y(v)) }
                val path = Path().apply { pts.forEachIndexed { i, o -> if (i == 0) moveTo(o.x, o.y) else lineTo(o.x, o.y) } }
                if (s.kind == ComboKind.AREA && pts.size > 1) {
                    val fill = Path().apply {
                        addPath(path)
                        lineTo(pts.last().x, bottom)
                        lineTo(pts.first().x, bottom)
                        close()
                    }
                    drawPath(fill, Brush.verticalGradient(listOf(s.color.copy(alpha = AREA_TOP_ALPHA), s.color.copy(alpha = 0f)), top, bottom))
                }
                if (pts.size == 1) drawCircle(s.color, 2.5.dp.toPx(), pts[0])
                else drawPath(path, s.color, style = Stroke(2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
            }
        }

        val active = touch?.let { ((it - left) / slot).toInt().coerceIn(0, n - 1) }
        if (marker != null && marker in 0 until n && p >= 1f && active == null) {
            val v = lines.maxOfOrNull { it.values.getOrNull(marker) ?: 0f } ?: 0f
            val o = Offset(x(marker), y(v))
            drawCircle(dot.copy(alpha = 0.25f), 7.dp.toPx(), o)
            drawCircle(c.background, 4.5.dp.toPx(), o)
            drawCircle(dot, 3.5.dp.toPx(), o)
            markerText?.let {
                val t = measurer.measure(it, TextStyle(color = dot, fontSize = 10.sp))
                drawText(t, topLeft = Offset((o.x - t.size.width / 2).coerceIn(0f, size.width - t.size.width), (o.y - 9.dp.toPx() - t.size.height).coerceAtLeast(0f)))
            }
        }
        active?.let { i ->
            drawLine(pal.axis.copy(alpha = 0.45f), Offset(x(i), top), Offset(x(i), bottom), 1.dp.toPx())
            lines.forEach { s -> s.values.getOrNull(i)?.let { v -> drawCircle(c.background, 4.5.dp.toPx(), Offset(x(i), y(v))); drawCircle(s.color, 3.dp.toPx(), Offset(x(i), y(v))) } }
            val text = buildAnnotatedString {
                append(labels[i])
                series.forEach { s ->
                    append("\n")
                    withStyle(SpanStyle(color = s.color)) { append("● ") }
                    append("${s.name} ${s.values.getOrNull(i)?.let { fmt(it) } ?: "-"}")
                }
            }
            val t = measurer.measure(text, TextStyle(color = c.text, fontSize = 11.sp))
            val pad = 8.dp.toPx()
            val bw = t.size.width + pad * 2
            val bh = t.size.height + pad * 2
            val bx = if (x(i) + 10.dp.toPx() + bw <= size.width) x(i) + 10.dp.toPx() else (x(i) - 10.dp.toPx() - bw).coerceAtLeast(0f)
            drawRoundRect(c.popover, Offset(bx, top), Size(bw, bh), CornerRadius(8.dp.toPx()))
            drawRoundRect(c.border, Offset(bx, top), Size(bw, bh), CornerRadius(8.dp.toPx()), style = Stroke(1.dp.toPx()))
            drawText(t, topLeft = Offset(bx + pad, top + pad))
        }
    }
}

/** 图例一项: 线是短横, 柱是小方块, 后面跟名字与数。 */
@Composable
fun ComboLegend(s: ComboSeries, value: String, modifier: Modifier = Modifier) {
    val c = Aioa.colors
    val fill = chartPalette().fill(s.color)
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        Canvas(Modifier.size(12.dp)) {
            if (s.kind == ComboKind.BAR) drawRoundRect(fill, Offset(1.dp.toPx(), 2.dp.toPx()), Size(size.width - 2.dp.toPx(), size.height - 4.dp.toPx()), CornerRadius(2.dp.toPx()))
            else drawLine(s.color, Offset(0f, size.height / 2), Offset(size.width, size.height / 2), 2.5.dp.toPx(), StrokeCap.Round)
        }
        Text(s.name, c.textSecondary, 12)
        Text(value, c.text, 12, weight = androidx.compose.ui.text.font.FontWeight.SemiBold)
    }
}

/** 把轴的最大值取整到 1, 1.5, 2, 3, 4, 5, 6, 8 × 10^k, 刻度好读又不空出一大截。 */
fun niceCeil(v: Float): Float {
    if (v <= 1f) return 1f
    var mag = 1f
    while (mag * 10 <= v) mag *= 10
    return NICE.first { it * mag >= v } * mag
}
