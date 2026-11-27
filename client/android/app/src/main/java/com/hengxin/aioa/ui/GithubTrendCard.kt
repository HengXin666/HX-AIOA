package com.hengxin.aioa.ui

import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.Constants
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Card
import com.hengxin.aioa.kit.Chip
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.MixChart
import com.hengxin.aioa.kit.MixLegend
import com.hengxin.aioa.kit.MixSeries
import com.hengxin.aioa.kit.MixStyle
import com.hengxin.aioa.kit.Paragraph
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.chartPalette
import com.hengxin.aioa.net.ApiCache
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private const val CACHE_TREND = "gh-trend"
private const val FOOT_SHOWN = 8

/** 拉走势: 先显示磁盘缓存, 再带 ETag 问服务端 (没变 304), 按设备时区分天。 */
private suspend fun loadTrend(context: Context, onTrend: (GhTrend) -> Unit) = withContext(Dispatchers.IO) {
    val q = mapOf("tz" to java.util.TimeZone.getDefault().id)
    ApiCache.get(context, CACHE_TREND, listOf(Constants.GITHUB_TREND_PATH), q) { body, _ ->
        val t = parseTrend(body)
        withContext(Dispatchers.Main) { onTrend(t) }
    }
}

/**
 * GitHub 走势 (#142): 14 天 / 12 周切换, 四张图分开画又能一眼区分:
 * 提交 = 面积; PR 新开 = 实线, 合入 = 柱, 没合入就关 = 点; Issue 新开 = 虚线, 关闭 = 柱;
 * 交付 = 合入的 PR 与关闭的 Issue 并排柱; 评论 = PR 实线, Issue 虚线, 评审点。点或拖任一张图, 四张一起选中那一格。
 */
@Composable
fun TrendCard(gh: GithubState) {
    if (!gh.enabled) return
    val context = LocalContext.current
    var trend by remember { mutableStateOf<GhTrend?>(null) }
    // 下拉刷新结束时再问一次, 没变是 304
    LaunchedEffect(gh.refreshing) { if (!gh.refreshing) loadTrend(context) { trend = it } }
    val t = trend ?: return
    var weekly by rememberSaveable { mutableStateOf(false) }
    var picked by rememberSaveable { mutableIntStateOf(-1) }
    val s = if (weekly) t.weeks else t.days
    if (s.points.isEmpty()) return
    val sel = picked.takeIf { it in s.points.indices } ?: s.points.lastIndex
    val c = Aioa.colors
    val pal = chartPalette()
    val labels = s.points.map { trendAxis(it.label) }
    fun of(name: String, color: androidx.compose.ui.graphics.Color, style: MixStyle, f: (GhTrendPoint) -> Int) = MixSeries(name, s.points.map { f(it).toFloat() }, color, style)
    val sum = s.total
    Card {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon("activity", c.textSecondary, 16.dp)
            Box(Modifier.weight(1f)) { Text("走势", c.text, GH_ROW_SP, weight = FontWeight.Medium) }
            Chip("14 天", !weekly) { weekly = false; picked = -1 }
            Chip("12 周", weekly) { weekly = true; picked = -1 }
        }
        Row {
            SummaryCell(sum.commits, "提交", Modifier.weight(1f))
            SummaryCell(sum.prMerged, "PR 合入", Modifier.weight(1f), pal.success)
            SummaryCell(sum.issueClosed, "Issue 关闭", Modifier.weight(1f), pal.teal)
            SummaryCell(sum.comments, "评论", Modifier.weight(1f))
        }
        val pick = { i: Int -> picked = i }
        Plot("提交", listOf(of("提交", pal.primary, MixStyle.AREA) { it.commits }), labels, sel, pick)
        Plot("PR", listOf(of("新开", pal.accent, MixStyle.LINE) { it.prOpened }, of("合入", pal.success, MixStyle.BARS) { it.prMerged }, of("没合入就关", pal.danger, MixStyle.DOTS) { it.prClosed }), labels, sel, pick)
        Plot("Issue", listOf(of("新开", pal.amber, MixStyle.DASHED) { it.issueOpened }, of("关闭", pal.teal, MixStyle.BARS) { it.issueClosed }), labels, sel, pick)
        Plot("交付", listOf(of("合入的 PR", pal.success, MixStyle.BARS) { it.prMerged }, of("关闭的 Issue", pal.teal, MixStyle.BARS) { it.issueClosed }), labels, sel, pick)
        Plot("评论", listOf(of("PR 评论", pal.accent, MixStyle.LINE) { it.prComments }, of("Issue 评论", pal.amber, MixStyle.DASHED) { it.issueComments }, of("评审", pal.primary, MixStyle.DOTS) { it.reviews }), labels, sel, pick)
        Paragraph(trendLine(s.points[sel], weekly), c.text, 13)
        val notes = buildList {
            if (s.received > 0) add("这段时间新开的 Issue / PR 共收到 ${s.received} 条评论")
            if (!t.done) add("正在补更早的 Issue / PR 与评论, 早些的格子可能偏少")
        }
        if (notes.isNotEmpty()) Text(notes.joinToString("; ") + "。", c.textSecondary, GH_META_SP)
    }
    FootprintCard(t)
}

/** 一张小图: 标题 + 图例 (带范围合计) + 混合图。 */
@Composable
private fun Plot(title: String, series: List<MixSeries>, labels: List<String>, sel: Int, onPick: (Int) -> Unit) {
    val c = Aioa.colors
    Column(Modifier.padding(top = 6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(title, c.text, 13, weight = FontWeight.Medium)
        MixLegend(series, series.map { "${it.values.sum().toInt()}" })
        MixChart(series, labels, selected = sel, grid = chartPalette().grid, axis = chartPalette().axis, onSelect = onPick)
    }
}

/** 足迹: 我新建的仓库 / 我 star 的仓库, 带时间, 点开 GitHub。 */
@Composable
private fun FootprintCard(t: GhTrend) {
    if (t.created.isEmpty() && t.starred.isEmpty()) return
    val context = LocalContext.current
    val c = Aioa.colors
    var stars by rememberSaveable { mutableStateOf(t.created.isEmpty()) }
    var all by rememberSaveable { mutableStateOf(false) }
    val list = if (stars) t.starred else t.created
    Card {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon("folder", c.textSecondary, 16.dp)
            Box(Modifier.weight(1f)) { Text("足迹", c.text, GH_ROW_SP, weight = FontWeight.Medium) }
            Chip("新建仓库 ${t.created.size}", !stars) { stars = false; all = false }
            Chip("Star ${t.starred.size}", stars) { stars = true; all = false }
        }
        if (list.isEmpty()) Text(if (stars) "还没有 star 过仓库。" else "近一年没有新建仓库。", c.textSecondary, 13)
        for (f in if (all) list else list.take(FOOT_SHOWN)) {
            val meta = metaOf(if (f.private) "私有" else "", f.stars?.let { "★ $it" }.orEmpty(), footDate(f.at))
            OneRow(if (stars) ICON_STAR else "folder", f.repo, meta, onClick = { openUrl(context, f.url) }, sub = f.description.orEmpty())
        }
        if (!all && list.size > FOOT_SHOWN) Chip("再显示 ${list.size - FOOT_SHOWN} 个", false) { all = true }
    }
}
