package com.hengxin.aioa.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Dot
import com.hengxin.aioa.kit.Text
import org.json.JSONObject

// CF 额度按 worker 拆分的共用部件: 图例, 分段条, 展开明细
class Part(val name: String, val used: Long)

private const val MAX_WORKERS = 4
private const val OTHER = "其他"
private val BAR_H = 6.dp

fun partsOf(o: JSONObject): List<Part> = o.optJSONArray("by")?.let { a ->
    (0 until a.length()).mapNotNull { a.optJSONObject(it) }.map { Part(it.optString("name"), it.optLong("used")) }
}.orEmpty()

/** 按各项占额度的比例之和排出前几名 worker, 各给一色, 其余归 "其他"。 */
fun topWorkers(rows: List<Pair<List<Part>, Long>>): List<String> =
    rows.flatMap { (by, limit) -> by.map { it.name to (if (limit > 0) it.used.toFloat() / limit else 0f) } }
        .groupBy({ it.first }, { it.second }).mapValues { it.value.sum() }
        .entries.sortedByDescending { it.value }.map { it.key }.take(MAX_WORKERS)

@Composable
fun workerColors(workers: List<String>): (String) -> Color {
    val c = Aioa.colors
    val palette = listOf(c.accent, c.success, c.warning, c.danger)
    return { name -> workers.indexOf(name).takeIf { it >= 0 }?.let { palette[it] } ?: c.textSecondary }
}

@Composable
fun Legend(workers: List<String>, colorOf: (String) -> Color) {
    val c = Aioa.colors
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        (workers + OTHER).forEach { w ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Dot(colorOf(w))
                Text(w, c.textSecondary, 12)
            }
        }
    }
}

/** 分段进度条: 每个 worker 一段, 宽度 = 它的用量 / 额度。 */
@Composable
fun SegBar(by: List<Part>, limit: Long, colorOf: (String) -> Color) {
    val c = Aioa.colors
    val total = limit.coerceAtLeast(1).toFloat()
    var left = 1f
    Row(Modifier.fillMaxWidth().height(BAR_H).clip(RoundedCornerShape(BAR_H / 2)).background(c.border)) {
        by.forEach { p ->
            val w = (p.used / total).coerceAtMost(left)
            if (w > 0f) Box(Modifier.weight(w).height(BAR_H).background(colorOf(p.name)))
            left -= w
        }
        if (left > 0f) Box(Modifier.weight(left).height(BAR_H))
    }
}

/** 点开一项后的各 worker 明细。 */
@Composable
fun PartList(by: List<Part>, colorOf: (String) -> Color, fmt: (Long) -> String) {
    val c = Aioa.colors
    by.forEach { p ->
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Dot(colorOf(p.name))
            Text(p.name, c.text, 13, Modifier.weight(1f))
            Text(fmt(p.used), c.textSecondary, 12)
        }
    }
}
