package com.hengxin.aioa.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.Constants
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.CountUp
import com.hengxin.aioa.kit.Heatmap
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.Panel
import com.hengxin.aioa.kit.SectionTitle
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.hxPalette
import com.hengxin.aioa.kit.pointerTap
import com.hengxin.aioa.net.ApiCache
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.time.DayOfWeek
import java.time.LocalDate

// 总览的 GitHub 热力格 (#134): 服务端每日 cron 算好的最近 140 天提交数, 带 ETag 缓存读
const val HEAT_DAYS = 140
const val HEAT_ROWS = 7
private const val HEAT_LEVELS = 4
private const val CACHE_HEATMAP = "gh-heatmap"
private const val HTTP_NOT_FOUND = 404

data class GhHeatmap(val days: Map<LocalDate, Int>, val updated: Long)

fun parseHeatmap(b: JSONObject): GhHeatmap {
    val arr = b.optJSONArray("days")
    val days = (0 until (arr?.length() ?: 0)).mapNotNull { i ->
        val o = arr?.optJSONObject(i) ?: return@mapNotNull null
        runCatching { LocalDate.parse(o.optString("date")) to o.optInt("commits") }.getOrNull()
    }.toMap()
    return GhHeatmap(days, b.optLong("updated"))
}

/** 按列 (一周一列, 周一在最上) 排好的格子级别 0..4; 第一列前面补空格对齐星期。 */
fun heatLevels(h: GhHeatmap, today: LocalDate): List<Int> {
    val start = today.minusDays((HEAT_DAYS - 1).toLong())
    val counts = (0 until HEAT_DAYS).map { h.days[start.plusDays(it.toLong())] ?: 0 }
    val max = counts.maxOrNull()?.takeIf { it > 0 } ?: 1
    val pad = start.dayOfWeek.value - DayOfWeek.MONDAY.value
    return List(pad) { 0 } + counts.map { if (it == 0) 0 else ((it * HEAT_LEVELS + max - 1) / max).coerceIn(1, HEAT_LEVELS) }
}

/** 本周 (周一起) 的提交数。 */
fun weekCommits(h: GhHeatmap, today: LocalDate): Int {
    val monday = today.minusDays((today.dayOfWeek.value - DayOfWeek.MONDAY.value).toLong())
    return h.days.filterKeys { !it.isBefore(monday) && !it.isAfter(today) }.values.sum()
}

private sealed interface Heat {
    data object Loading : Heat
    data object Missing : Heat
    data class Ready(val map: GhHeatmap) : Heat
}

/** GitHub 区块: 本周提交数 + 热力格 + 最新 CI 一行; 服务端没有这个接口 (404) 或插件停用时整块不显示。 */
@Composable
internal fun GithubHeatBlock(chat: ChatModel, openGithub: () -> Unit, modifier: Modifier) {
    val gh = chat.github
    if (!gh.enabled) return
    val context = LocalContext.current
    LaunchedEffect(Unit) { gh.refreshIfStale() }
    val heat by produceState<Heat>(Heat.Loading) {
        var code = 0
        withContext(Dispatchers.IO) {
            ApiCache.get(context, CACHE_HEATMAP, listOf(Constants.GITHUB_HEATMAP_PATH), onCode = { code = it }) { body, _ -> value = Heat.Ready(parseHeatmap(body)) }
        }
        if (code == HTTP_NOT_FOUND) value = Heat.Missing
    }
    val map = (heat as? Heat.Ready)?.map ?: return
    if (map.days.isEmpty()) return
    val c = Aioa.colors
    val today = LocalDate.now()
    Column(modifier) {
        SectionTitle(GITHUB_TITLE, action = "全部", onAction = openGithub)
        Panel(Modifier.fillMaxWidth().pointerTap(openGithub)) {
            Row(Modifier.padding(start = 16.dp, end = 16.dp, top = 14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(ICON_GITHUB, c.text, 18.dp)
                Column(Modifier.weight(1f)) {
                    CountUp(weekCommits(map, today), 26, c.text)
                    Text("本周提交", c.textSecondary, 12)
                }
                Text("近 $HEAT_DAYS 天 ${map.days.values.sum()} 次", c.textSecondary, 12)
            }
            Heatmap(heatLevels(map, today), HEAT_ROWS, hxPalette().chart2, Modifier.padding(horizontal = 16.dp, vertical = 12.dp).fillMaxWidth().height(110.dp), delayMs = 200)
            Row(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                CiLine(gh.latestCi)
                Spacer(Modifier.weight(1f))
                gh.repos.maxByOrNull { it.ci?.at ?: 0L }?.takeIf { it.ci != null }?.let { Text(it.repo, c.textSecondary, GH_META_SP) }
            }
        }
    }
}
