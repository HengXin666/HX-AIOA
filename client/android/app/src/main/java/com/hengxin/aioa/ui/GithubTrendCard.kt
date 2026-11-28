package com.hengxin.aioa.ui

import android.content.Context
import androidx.compose.foundation.layout.Arrangement
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
import com.hengxin.aioa.kit.Chip
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
 * GitHub 走势 (#142 #145): 14 天 / 12 周切换; 提交, PR, Issue, 评论一张双轴合一图 (TrendPanel),
 * 可切回拆分小图; 点或拖选中一格, 提示框列出每个系列这一格的数。
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
    val sum = s.total
    FoldCard(FOLD_TREND, "activity", "走势", "提交 ${sum.commits}", trailing = {
        Chip("14 天", !weekly) { weekly = false; picked = -1 }
        Chip("12 周", weekly) { weekly = true; picked = -1 }
    }) {
        Row {
            SummaryCell(sum.commits, "提交", Modifier.weight(1f))
            SummaryCell(sum.prMerged, "PR 合入", Modifier.weight(1f), pal.success)
            SummaryCell(sum.issueClosed, "Issue 关闭", Modifier.weight(1f), pal.teal)
            SummaryCell(sum.comments, "评论", Modifier.weight(1f))
        }
        TrendPanel(s.points, weekly, picked, { picked = it }, FOLD_TREND)
        Paragraph(trendLine(s.points[sel], weekly), c.text, 13)
        val notes = buildList {
            if (s.received > 0) add("这段时间新开的 Issue / PR 共收到 ${s.received} 条评论")
            if (!t.done) add("正在补更早的 Issue / PR 与评论, 早些的格子可能偏少")
        }
        if (notes.isNotEmpty()) Text(notes.joinToString("; ") + "。", c.textSecondary, GH_META_SP)
    }
    FootprintCard(t)
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
    FoldCard(FOLD_FOOT, "folder", "足迹", trailing = {
        Chip("新建仓库 ${t.created.size}", !stars) { stars = false; all = false }
        Chip("Star ${t.starred.size}", stars) { stars = true; all = false }
    }) {
        if (list.isEmpty()) Text(if (stars) "还没有 star 过仓库。" else "还没有新建仓库。", c.textSecondary, 13)
        for (f in if (all) list else list.take(FOOT_SHOWN)) {
            // 新建仓库区分 fork 与自建 (#144), fork 写上游
            val origin = if (stars) "" else repoOrigin(f.fork, f.parent)
            val meta = metaOf(origin, if (f.private) "私有" else "", f.stars?.let { "★ $it" }.orEmpty(), footDate(f.at))
            val icon = if (stars) ICON_STAR else if (f.fork) ICON_FORK else "folder"
            OneRow(icon, f.repo, meta, onClick = { openUrl(context, f.url) }, sub = f.description.orEmpty())
        }
        if (!all && list.size > FOOT_SHOWN) Chip("再显示 ${list.size - FOOT_SHOWN} 个", false) { all = true }
    }
}
