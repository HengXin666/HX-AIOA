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
import androidx.compose.ui.platform.LocalContext
import com.hengxin.aioa.Constants
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Chip
import com.hengxin.aioa.kit.Paragraph
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.net.ApiCache
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

// 单仓库页的走势 (#144 #145): 同一接口带 repo, 只算这个仓库; 图与 GitHub 页总走势同一个合一图 (TrendPanel)
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

/** 单仓库页: 我在这个仓库的提交 / PR / Issue / 评论一张合一图, 14 天 / 12 周切换, 点或拖选中一格看明细。 */
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
    FoldCard(FOLD_REPO_TREND, "activity", "走势", "提交 ${s.total.commits}", trailing = {
        Chip("14 天", !weekly) { weekly = false; picked = -1 }
        Chip("12 周", weekly) { weekly = true; picked = -1 }
    }) {
        TrendPanel(s.points, weekly, picked, { picked = it }, FOLD_REPO_TREND)
        Paragraph(trendLine(s.points[sel], weekly), c.text, 13)
        Text("只算我在这个仓库的。", c.textSecondary, GH_META_SP)
    }
}
