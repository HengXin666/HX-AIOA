package com.hengxin.aioa.ui

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import com.hengxin.aioa.Constants
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Chip
import com.hengxin.aioa.kit.DualMixChart
import com.hengxin.aioa.kit.MixLegend
import com.hengxin.aioa.kit.MixSeries
import com.hengxin.aioa.kit.MixStyle
import com.hengxin.aioa.kit.Paragraph
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.chartPalette
import com.hengxin.aioa.net.ApiCache
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

// 单仓库页的走势 (#144): 同一接口带 repo, 只算这个仓库; PR 与 Issue 共用左轴, 提交量级大得多, 单独用右轴
private const val CACHE_REPO_TREND = "gh-trend-repo-"

/** 磁盘缓存名: owner/name 里的斜杠换掉。 */
fun repoTrendCache(repo: String): String = CACHE_REPO_TREND + repo.replace('/', '_')

private suspend fun loadRepoTrend(context: Context, repo: String, onTrend: (GhTrend) -> Unit) = withContext(Dispatchers.IO) {
    val q = mapOf("tz" to java.util.TimeZone.getDefault().id, "repo" to repo)
    ApiCache.get(context, repoTrendCache(repo), listOf(Constants.GITHUB_TREND_PATH), q) { body, _ ->
        val t = parseTrend(body)
        withContext(Dispatchers.Main) { onTrend(t) }
    }
}

/** 混合图的两组系列: 左轴 PR / Issue, 右轴提交。 */
data class RepoTrendSeries(val left: List<MixSeries>, val right: List<MixSeries>)

fun repoTrendSeries(points: List<GhTrendPoint>, pr: Color, merged: Color, issue: Color, closed: Color, commit: Color): RepoTrendSeries {
    fun of(name: String, color: Color, style: MixStyle, f: (GhTrendPoint) -> Int) = MixSeries(name, points.map { f(it).toFloat() }, color, style)
    return RepoTrendSeries(
        listOf(
            of("PR 新开", pr, MixStyle.LINE) { it.prOpened },
            of("PR 合入", merged, MixStyle.BARS) { it.prMerged },
            of("Issue 新开", issue, MixStyle.DASHED) { it.issueOpened },
            of("Issue 关闭", closed, MixStyle.DOTS) { it.issueClosed },
        ),
        listOf(of("提交 (右轴)", commit, MixStyle.AREA) { it.commits }),
    )
}

/** 单仓库页: 我在这个仓库的 PR / Issue / 提交一张混合图, 14 天 / 12 周切换, 点或拖选中一格看明细。 */
@Composable
fun RepoTrendCard(repo: String, reload: Int) {
    val context = LocalContext.current
    var trend by remember(repo) { mutableStateOf<GhTrend?>(null) }
    LaunchedEffect(repo, reload) { loadRepoTrend(context, repo) { trend = it } }
    val t = trend ?: return
    var weekly by rememberSaveable { mutableStateOf(false) }
    var picked by rememberSaveable(repo) { mutableIntStateOf(-1) }
    val s = if (weekly) t.weeks else t.days
    if (s.points.isEmpty()) return
    val sel = picked.takeIf { it in s.points.indices } ?: s.points.lastIndex
    val c = Aioa.colors
    val pal = chartPalette()
    val series = repoTrendSeries(s.points, pal.accent, pal.success, pal.amber, pal.teal, pal.primary)
    val all = series.left + series.right
    FoldCard(FOLD_REPO_TREND, "activity", "走势", "提交 ${s.total.commits}", trailing = {
        Chip("14 天", !weekly) { weekly = false; picked = -1 }
        Chip("12 周", weekly) { weekly = true; picked = -1 }
    }) {
        MixLegend(all, all.map { "${it.values.sum().toInt()}" })
        DualMixChart(series.left, series.right, s.points.map { trendAxis(it.label) }, selected = sel, grid = pal.grid, axis = pal.axis, onSelect = { picked = it })
        Paragraph(trendLine(s.points[sel], weekly), c.text, 13)
        Text("左轴 PR / Issue, 右轴提交; 只算我在这个仓库的。", c.textSecondary, GH_META_SP)
    }
}
