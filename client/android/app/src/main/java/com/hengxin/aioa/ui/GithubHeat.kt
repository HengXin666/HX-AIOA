package com.hengxin.aioa.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.Constants
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Card
import com.hengxin.aioa.kit.Chip
import com.hengxin.aioa.kit.CountUp
import com.hengxin.aioa.kit.Heatmap
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.hxPalette
import com.hengxin.aioa.net.ApiCache
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.time.DayOfWeek
import java.time.LocalDate

// GitHub 页顶部的提交热力格 (#134): 默认最近 140 天, 可按年切换看全部历史; 带 ETag 缓存读
const val HEAT_DAYS = 140
const val HEAT_ROWS = 7
private const val HEAT_LEVELS = 4
private const val RECENT = 0
private const val CACHE_HEATMAP = "gh-heatmap"
// 按年看时每格 (含间隔) 的宽度, 一年 53 列横向滚动
private val HEAT_STEP = 13.dp
private val HEAT_GAP = 3.dp
private val RECENT_H = 110.dp

/** days 按日期从早到晚; years 是有数据的年份 (新的在前); pending 是全部历史还没回填完的仓库数。 */
data class GhHeatmap(
    val days: Map<LocalDate, Int>,
    val updated: Long,
    val years: List<Int> = emptyList(),
    val pending: Int = 0,
    val oldest: String? = null,
)

fun parseHeatmap(b: JSONObject): GhHeatmap {
    val arr = b.optJSONArray("days")
    val days = (0 until (arr?.length() ?: 0)).mapNotNull { i ->
        val o = arr?.optJSONObject(i) ?: return@mapNotNull null
        runCatching { LocalDate.parse(o.optString("date")) to o.optInt("commits") }.getOrNull()
    }.sortedBy { it.first }.toMap(LinkedHashMap())
    val ys = b.optJSONArray("years")
    val years = (0 until (ys?.length() ?: 0)).map { ys!!.optInt(it) }.filter { it > 0 }
    val fill = b.optJSONObject("backfill")
    return GhHeatmap(days, b.optLong("updated"), years, fill?.optInt("pending") ?: 0, fill?.optString("oldest")?.ifEmpty { null })
}

/** 按列 (一周一列, 周一在最上) 排好的格子级别 0..4; 第一列前面补空格对齐星期。 */
fun heatLevels(h: GhHeatmap): List<Int> {
    val start = h.days.keys.minOrNull() ?: return emptyList()
    val end = h.days.keys.max()
    val n = (end.toEpochDay() - start.toEpochDay() + 1).toInt()
    val counts = (0 until n).map { h.days[start.plusDays(it.toLong())] ?: 0 }
    val max = counts.maxOrNull()?.takeIf { it > 0 } ?: 1
    val pad = start.dayOfWeek.value - DayOfWeek.MONDAY.value
    return List(pad) { 0 } + counts.map { if (it == 0) 0 else ((it * HEAT_LEVELS + max - 1) / max).coerceIn(1, HEAT_LEVELS) }
}

/** 本周 (周一起) 的提交数。 */
fun weekCommits(h: GhHeatmap, today: LocalDate): Int {
    val monday = today.minusDays((today.dayOfWeek.value - DayOfWeek.MONDAY.value).toLong())
    return h.days.filterKeys { !it.isBefore(monday) && !it.isAfter(today) }.values.sum()
}

/** 回填进度一行: 还在拉就说还剩几个仓库, 拉完说覆盖到哪天。 */
fun backfillLine(h: GhHeatmap): String? = when {
    h.pending > 0 -> "正在回填历史提交, 还有 ${h.pending} 个仓库"
    h.oldest != null -> "历史提交已覆盖到 ${h.oldest}"
    else -> null
}

/** GitHub 页顶部: 本周 (或某一年) 提交数 + 热力格, 下面切年份; 插件停用或服务端没有这个接口时不显示。 */
@Composable
fun GithubHeatCard(gh: GithubState) {
    if (!gh.enabled) return
    val context = LocalContext.current
    var year by rememberSaveable { mutableIntStateOf(RECENT) }
    var heat by remember { mutableStateOf<GhHeatmap?>(null) }
    var years by remember { mutableStateOf<List<Int>>(emptyList()) }
    LaunchedEffect(year) {
        withContext(Dispatchers.IO) {
            // 按设备时区分天 (#139), 和 "本周提交" 一个口径
            val zone = "tz" to java.util.TimeZone.getDefault().id
            val q = if (year == RECENT) mapOf(zone) else mapOf("year" to year.toString(), zone)
            val name = if (year == RECENT) CACHE_HEATMAP else "$CACHE_HEATMAP-$year"
            ApiCache.get(context, name, listOf(Constants.GITHUB_HEATMAP_PATH), q) { body, _ ->
                val m = parseHeatmap(body)
                withContext(Dispatchers.Main) {
                    heat = m
                    if (m.years.isNotEmpty()) years = m.years
                }
            }
        }
    }
    val map = heat ?: return
    if (map.days.isEmpty() && years.isEmpty()) return
    val c = Aioa.colors
    val total = map.days.values.sum()
    Card {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(ICON_GITHUB, c.text, 18.dp)
            Column(Modifier.weight(1f)) {
                CountUp(if (year == RECENT) weekCommits(map, LocalDate.now()) else total, 26, c.text)
                Text(if (year == RECENT) "本周提交" else "$year 年提交", c.textSecondary, GH_META_SP)
            }
            if (year == RECENT) Text("近 $HEAT_DAYS 天 $total 次", c.textSecondary, GH_META_SP)
        }
        HeatGrid(map, year != RECENT)
        if (years.size > 1 || years.firstOrNull()?.let { it != LocalDate.now().year } == true) {
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Chip("近 $HEAT_DAYS 天", year == RECENT) { year = RECENT }
                years.forEach { y -> Chip("$y", year == y) { year = y } }
            }
        }
        backfillLine(map)?.let { Text(it, c.textSecondary, GH_META_SP) }
    }
}

/** 最近 140 天铺满宽度; 一整年按固定格宽横向滚动, 打开时滚到最右 (最近)。 */
@Composable
private fun HeatGrid(map: GhHeatmap, wide: Boolean) {
    val levels = heatLevels(map)
    val color = hxPalette().chart2
    if (!wide) return Heatmap(levels, HEAT_ROWS, color, Modifier.fillMaxWidth().height(RECENT_H), delayMs = 200)
    val cols = (levels.size + HEAT_ROWS - 1) / HEAT_ROWS
    val scroll = rememberScrollState()
    LaunchedEffect(cols) { scroll.scrollTo(scroll.maxValue) }
    Row(Modifier.fillMaxWidth().horizontalScroll(scroll)) {
        Heatmap(levels, HEAT_ROWS, color, Modifier.width(HEAT_STEP * cols - HEAT_GAP).height(HEAT_STEP * HEAT_ROWS - HEAT_GAP))
    }
}
