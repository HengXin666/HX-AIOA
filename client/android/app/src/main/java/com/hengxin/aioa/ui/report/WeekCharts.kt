package com.hengxin.aioa.ui.report

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.rememberReveal
import com.hengxin.aioa.link.BatteryLog
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

// 周报图表 (#140), 对应 docs/design/weekly-report/prototype.html; 只用 HX-UI 图表色, 全部本地画

private const val HOURS = 24
private const val DEG_PER_HOUR = 15f
private const val TOP_DEG = -90f
private const val GAP_DEG = 0.8f
private const val HOT = 0.66f
private const val WARM = 0.33f

/** 周时钟: 每一圈是一天 (内圈第一天), 每一格是一小时, 越亮在前台越久。 */
@Composable
fun WeekClock(minutes: Array<IntArray>, cool: Color, mid: Color, hot: Color, modifier: Modifier, center: @Composable BoxScope.() -> Unit) {
    val p = rememberReveal(150, 1400)
    val empty = Aioa.colors.surfaceAlt
    val mx = (minutes.maxOfOrNull { it.maxOrNull() ?: 0 } ?: 0).coerceAtLeast(1)
    val n = minutes.size
    Box(modifier, contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val r = size.minDimension / 2
            val inner = r * 0.3f
            val ring = (r - inner) / n.coerceAtLeast(1)
            val o = Offset(size.width / 2, size.height / 2)
            minutes.forEachIndexed { d, row ->
                val mid0 = inner + ring * d + ring / 2
                row.forEachIndexed { h, v ->
                    val shown = (d * HOURS + h).toFloat() / (n * HOURS) <= p
                    val k = v.toFloat() / mx
                    val color = when {
                        v == 0 || !shown -> empty
                        k > HOT -> hot
                        k > WARM -> mid
                        else -> cool
                    }.copy(alpha = if (v == 0 || !shown) 0.5f else 0.25f + 0.75f * k)
                    drawArc(color, TOP_DEG + h * DEG_PER_HOUR + GAP_DEG / 2, DEG_PER_HOUR - GAP_DEG, false,
                        Offset(o.x - mid0, o.y - mid0), Size(mid0 * 2, mid0 * 2), style = Stroke(ring * 0.82f))
                }
            }
        }
        center()
    }
}

/** 每天一根渐变圆角柱, 柱顶写 top, 柱底写 bottom (如打开次数)。 */
@Composable
fun DayBars(values: List<Long>, top: List<String>, bottom: List<String>, labels: List<String>, from: Color, to: Color, modifier: Modifier) {
    val p = rememberReveal(200, 1000)
    val m = rememberTextMeasurer()
    val c = Aioa.colors
    val mx = (values.maxOrNull() ?: 0L).coerceAtLeast(1L)
    Canvas(modifier) {
        val n = values.size.coerceAtLeast(1)
        val slot = size.width / n
        val w = slot * 0.62f
        val base = size.height - 18.dp.toPx()
        val room = base - 18.dp.toPx()
        values.forEachIndexed { i, v ->
            val x = i * slot + (slot - w) / 2
            val h = (v.toFloat() / mx * room * p).coerceAtLeast(if (v > 0) 4.dp.toPx() else 0f)
            drawRoundRect(Brush.verticalGradient(listOf(from, to.copy(alpha = 0.35f)), base - h, base), Offset(x, base - h), Size(w, h), CornerRadius(8.dp.toPx()))
            label(m, top.getOrElse(i) { "" }, Offset(x + w / 2, base - h - 16.dp.toPx()), c.text, 11)
            if (h > 18.dp.toPx()) label(m, bottom.getOrElse(i) { "" }, Offset(x + w / 2, base - 16.dp.toPx()), Color.Black.copy(alpha = 0.75f), 10, true)
            label(m, labels.getOrElse(i) { "" }, Offset(x + w / 2, base + 3.dp.toPx()), c.textSecondary, 11)
        }
    }
}

/** 每天的堆叠柱 (各段颜色对应 colors), line 是叠在上面的折线 (如我看过的)。 */
@Composable
fun StackBars(parts: Array<IntArray>, colors: List<Color>, line: List<Int>, labels: List<String>, lineColor: Color, modifier: Modifier) {
    val p = rememberReveal(200, 1000)
    val m = rememberTextMeasurer()
    val c = Aioa.colors
    val mx = (parts.maxOfOrNull { it.sum() } ?: 0).coerceAtLeast(1)
    Canvas(modifier) {
        val n = parts.size.coerceAtLeast(1)
        val slot = size.width / n
        val w = slot * 0.56f
        val base = size.height - 18.dp.toPx()
        val room = base - 6.dp.toPx()
        parts.forEachIndexed { i, day ->
            var y = base
            val x = i * slot + (slot - w) / 2
            day.forEachIndexed { k, v ->
                val h = v.toFloat() / mx * room * p
                if (h <= 0f) return@forEachIndexed
                y -= h
                drawRoundRect(colors[k % colors.size], Offset(x, y), Size(w, (h - 2.dp.toPx()).coerceAtLeast(1f)), CornerRadius(4.dp.toPx()))
            }
            label(m, labels.getOrElse(i) { "" }, Offset(x + w / 2, base + 3.dp.toPx()), c.textSecondary, 11)
        }
        val pts = line.mapIndexed { i, v -> Offset(i * slot + slot / 2, base - v.toFloat() / mx * room * p) }
        pts.zipWithNext { a, b -> drawLine(lineColor, a, b, 2.dp.toPx(), StrokeCap.Round) }
        pts.forEach { drawCircle(lineColor, 3.dp.toPx(), it) }
    }
}

/** 甜甜圈: 各段按比例, 段间留缝, 圆头; 中间放内容。 */
@Composable
fun Donut(parts: List<Pair<Int, Color>>, modifier: Modifier, center: @Composable BoxScope.() -> Unit) {
    val p = rememberReveal(150, 1200)
    val track = Aioa.colors.surfaceAlt
    val total = parts.sumOf { it.first }.coerceAtLeast(1)
    Box(modifier, contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val s = 16.dp.toPx()
            val tl = Offset(s / 2, s / 2)
            val sz = Size(size.width - s, size.height - s)
            drawArc(track, 0f, 360f, false, tl, sz, style = Stroke(s))
            var start = TOP_DEG
            parts.forEach { (v, color) ->
                val sweep = 360f * v / total
                if (sweep > 4f) drawArc(color, start + 2f, (sweep - 4f) * p, false, tl, sz, style = Stroke(s, cap = StrokeCap.Round))
                start += sweep
            }
        }
        center()
    }
}

/** 人际轨道图里的一个点: 名字, 条数, 是不是 Agent。 */
data class OrbitPeer(val name: String, val count: Int, val agent: Boolean)

/** 我在中间, Agent 在内圈, 真人在外圈; 点的大小与连线粗细按条数 (平方根)。 */
@Composable
fun Orbit(peers: List<OrbitPeer>, me: Color, agent: Color, human: Color, modifier: Modifier) {
    val p = rememberReveal(200, 1200)
    val m = rememberTextMeasurer()
    val c = Aioa.colors
    val mx = (peers.maxOfOrNull { it.count } ?: 0).coerceAtLeast(1)
    Canvas(modifier) {
        val o = Offset(size.width / 2, size.height / 2)
        val ry = size.height / 2 - 22.dp.toPx()
        val rx = size.width / 2 - 34.dp.toPx()
        val rings = listOf(peers.filter { it.agent } to 0.55f, peers.filter { !it.agent } to 1f)
        rings.forEach { (_, k) -> drawOval(c.border, Offset(o.x - rx * k, o.y - ry * k), Size(rx * 2 * k, ry * 2 * k), style = Stroke(1f)) }
        rings.forEachIndexed { ri, (list, k) ->
            list.forEachIndexed { i, peer ->
                val a = (-PI / 2 + ri * 0.35 + i * 2 * PI / list.size).toFloat()
                val at = Offset(o.x + rx * k * cos(a), o.y + ry * k * sin(a))
                val f = sqrt(peer.count.toFloat() / mx)
                val tone = if (peer.agent) agent else human
                val end = o + (at - o) * p
                drawLine(tone.copy(alpha = 0.15f + 0.5f * f), o, end, (1 + 5 * f).dp.toPx(), StrokeCap.Round)
                val rad = (5 + 13 * f).dp.toPx() * p
                drawCircle(tone.copy(alpha = 0.15f), rad + 4.dp.toPx(), end)
                drawCircle(tone, rad, end)
                if (p > 0.95f) label(m, peer.name, Offset(end.x, end.y + rad + 2.dp.toPx()), c.text, 10)
            }
        }
        drawCircle(Brush.linearGradient(listOf(me, human), o - Offset(24f, 24f), o + Offset(24f, 24f)), 22.dp.toPx(), o)
        label(m, "我", Offset(o.x, o.y - 9.dp.toPx()), Color.White, 14, true)
    }
}

/** 竖条分布 (如请求耗时分桶), 每根自带颜色与下方标签。 */
@Composable
fun Histogram(values: LongArray, colors: List<Color>, labels: List<String>, modifier: Modifier) {
    val p = rememberReveal(200, 900)
    val m = rememberTextMeasurer()
    val c = Aioa.colors
    val mx = (values.maxOrNull() ?: 0L).coerceAtLeast(1L)
    Canvas(modifier) {
        val n = values.size.coerceAtLeast(1)
        val slot = size.width / n
        val w = slot * 0.78f
        val base = size.height - 16.dp.toPx()
        values.forEachIndexed { i, v ->
            val h = (v.toFloat() / mx * base * p).coerceAtLeast(if (v > 0) 2.dp.toPx() else 0f)
            drawRoundRect(colors.getOrElse(i) { colors.last() }, Offset(i * slot, base - h), Size(w, h), CornerRadius(5.dp.toPx()))
            label(m, labels.getOrElse(i) { "" }, Offset(i * slot + w / 2, base + 2.dp.toPx()), c.textSecondary, 9)
        }
    }
}

/** 一段时间的电量曲线: 亮屏段铺浅底, 充电段换色。 */
@Composable
fun BatteryRange(points: List<BatteryLog.Point>, from: Long, to: Long, line: Color, charge: Color, screen: Color, modifier: Modifier) {
    if (points.size < 2 || to <= from) return
    val c = Aioa.colors
    Canvas(modifier) {
        val x = { at: Long -> (at - from).toFloat() / (to - from) * size.width }
        val y = { pct: Int -> size.height * (1f - pct / 100f) }
        points.zipWithNext { a, b -> if (a.screen) drawRect(screen, Offset(x(a.at), 0f), Size((x(b.at) - x(a.at)).coerceAtLeast(1f), size.height)) }
        for (k in 1..3) drawLine(c.border.copy(alpha = 0.5f), Offset(0f, size.height * k / 4), Offset(size.width, size.height * k / 4), 1f)
        points.zipWithNext { a, b -> if (b.at - a.at < 3_600_000L) drawLine(if (a.plugged) charge else line, Offset(x(a.at), y(a.pct)), Offset(x(b.at), y(b.pct)), 2.dp.toPx(), StrokeCap.Round) }
    }
}

/** 以 at 为上边中点写一行字。 */
private fun DrawScope.label(m: androidx.compose.ui.text.TextMeasurer, text: String, at: Offset, color: Color, sp: Int, bold: Boolean = false) {
    if (text.isEmpty()) return
    val r = m.measure(text, TextStyle(color = color, fontSize = sp.sp, fontWeight = if (bold) FontWeight.SemiBold else FontWeight.Normal))
    drawText(r, topLeft = Offset(at.x - r.size.width / 2f, at.y))
}
