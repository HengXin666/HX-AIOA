package com.hengxin.aioa.ui.settings

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.CountUp
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.hxPalette
import com.hengxin.aioa.link.BatteryLog
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

// 调试模式的可视化 (#139): 请求状态分布, 耗时, 最常 / 最慢的路径, 近 24 小时电量曲线; 文字记录仍在下面

private const val TOP = 5
private const val P95 = 0.95
private val BAR_H = 10.dp

/** 一行请求记录: "HH:mm:ss GET /api/v1/x 200 123ms"; 路径里可能有空格 (外部地址的说明), 从两头取。 */
data class HttpLine(val method: String, val path: String, val code: String, val ms: Long)

fun parseHttp(line: String): HttpLine? {
    val p = line.trim().split(' ')
    if (p.size < 5) return null
    val ms = p.last().removeSuffix("ms").toLongOrNull() ?: return null
    return HttpLine(p[1], p.subList(2, p.size - 2).joinToString(" "), p[p.size - 2], ms)
}

/** 状态分档: 2xx / 3xx / 4xx / 5xx / 失败 (异常名)。 */
fun codeClass(code: String): Int = code.toIntOrNull()?.let { (it / 100).coerceIn(1, 5) } ?: 0

@Composable
fun HttpVisual(lines: List<String>) {
    val rows = lines.mapNotNull(::parseHttp)
    if (rows.isEmpty()) return
    val c = Aioa.colors
    val pal = hxPalette()
    val sorted = rows.map { it.ms }.sorted()
    val p95 = sorted[((sorted.size - 1) * P95).toInt()]
    val fail = rows.count { codeClass(it.code) == 0 || codeClass(it.code) >= 4 }
    val classes = listOf(2 to ("2xx" to c.success), 3 to ("3xx/101" to pal.chart1), 4 to ("4xx" to c.warning), 5 to ("5xx" to c.danger), 0 to ("断开" to c.textSecondary))
    val counts = classes.map { (k, v) -> Triple(v.first, v.second, rows.count { codeClass(it.code) == k || (k == 3 && codeClass(it.code) == 1) }) }.filter { it.third > 0 }
    Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Kpi(rows.size, "次请求", c.text, Modifier.weight(1f))
            Kpi(fail, "次失败", if (fail > 0) c.danger else c.textSecondary, Modifier.weight(1f))
            Kpi(sorted[sorted.size / 2].toInt(), "ms 中位", pal.chart1, Modifier.weight(1f))
            Kpi(p95.toInt(), "ms P95", pal.chart2, Modifier.weight(1f))
        }
        // 状态分布: 一根分段条
        Row(Modifier.fillMaxWidth().height(BAR_H).clip(RoundedCornerShape(5.dp))) {
            counts.forEach { (_, color, n) -> Box(Modifier.weight(n.toFloat()).height(BAR_H).background(color)) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            counts.forEach { (label, color, n) ->
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Box(Modifier.size(8.dp).clip(RoundedCornerShape(2.dp)).background(color))
                    Text("$label $n", c.textSecondary, 12)
                }
            }
        }
        val byPath = rows.groupBy { it.path }
        Bars("最常请求", byPath.mapValues { it.value.size.toLong() }, "次", pal.chart1)
        Bars("最慢 (平均)", byPath.mapValues { e -> e.value.sumOf { it.ms } / e.value.size }, "ms", pal.chart2)
    }
}

@Composable
private fun Kpi(n: Int, label: String, tone: Color, modifier: Modifier) {
    Column(modifier.clip(RoundedCornerShape(10.dp)).background(tone.copy(alpha = 0.1f)).padding(8.dp)) {
        CountUp(n, 17, tone)
        Text(label, Aioa.colors.textSecondary, 11)
    }
}

/** 横条排行: 前 5 个, 条长按最大值。 */
@Composable
private fun Bars(title: String, data: Map<String, Long>, unit: String, color: Color) {
    val c = Aioa.colors
    val top = data.entries.sortedByDescending { it.value }.take(TOP)
    val max = (top.firstOrNull()?.value ?: 1L).coerceAtLeast(1L)
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title, c.text, 13, weight = FontWeight.Medium)
        top.forEach { (path, v) ->
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Row {
                    Text(path, c.textSecondary, 12, Modifier.weight(1f), maxLines = 1)
                    Text("$v $unit", c.text, 12)
                }
                Box(Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)).background(c.surfaceAlt)) {
                    Box(Modifier.fillMaxWidth(v.toFloat() / max).height(6.dp).clip(RoundedCornerShape(3.dp)).background(color))
                }
            }
        }
    }
}

/** 近 24 小时电量曲线: 亮屏段底下铺浅色, 充电段用另一种颜色描线。 */
@Composable
fun BatteryVisual(tick: Int) {
    val context = LocalContext.current
    val pts = produceState(emptyList<BatteryLog.Point>(), tick) { value = withContext(Dispatchers.IO) { BatteryLog.points(context) } }.value
    if (pts.size < 2) return
    val c = Aioa.colors
    val pal = hxPalette()
    val t0 = pts.first().at
    val span = (pts.last().at - t0).coerceAtLeast(1L).toFloat()
    Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Canvas(Modifier.fillMaxWidth().height(120.dp)) {
            val x = { at: Long -> (at - t0) / span * size.width }
            val y = { pct: Int -> size.height * (1f - pct / 100f) }
            pts.zipWithNext { a, b ->
                if (a.screen) drawRect(pal.chart1.copy(alpha = 0.12f), Offset(x(a.at), 0f), Size(x(b.at) - x(a.at), size.height))
            }
            for (k in 1..3) drawLine(c.border.copy(alpha = 0.5f), Offset(0f, size.height * k / 4), Offset(size.width, size.height * k / 4), 1f)
            pts.zipWithNext { a, b ->
                drawLine(if (a.plugged) c.success else pal.chart2, Offset(x(a.at), y(a.pct)), Offset(x(b.at), y(b.pct)), 2.5.dp.toPx())
            }
            val last = pts.last()
            drawCircle(pal.chart2, 4.dp.toPx(), Offset(x(last.at), y(last.pct)))
            drawCircle(pal.chart2.copy(alpha = 0.25f), 8.dp.toPx(), Offset(x(last.at), y(last.pct)), style = Stroke(2.dp.toPx()))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Legend(pal.chart2, "电量")
            Legend(c.success, "充电")
            Legend(pal.chart1.copy(alpha = 0.35f), "亮屏")
            Box(Modifier.weight(1f))
            Text("现在 ${pts.last().pct}%", c.text, 12, weight = FontWeight.Medium)
        }
    }
}

@Composable
private fun Legend(color: Color, label: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Box(Modifier.width(10.dp).height(4.dp).clip(RoundedCornerShape(2.dp)).background(color))
        Text(label, Aioa.colors.textSecondary, 12)
    }
}
