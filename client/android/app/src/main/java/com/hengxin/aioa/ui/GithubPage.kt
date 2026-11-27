package com.hengxin.aioa.ui

import com.hengxin.aioa.kit.AnimatedItems
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Dot
import com.hengxin.aioa.kit.Card
import com.hengxin.aioa.kit.CardState
import com.hengxin.aioa.kit.Chip
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.Paragraph
import com.hengxin.aioa.kit.StateBody
import com.hengxin.aioa.kit.Text

/** 下拉刷新外壳: GitHub 列表与详情共用。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GhRefreshBox(refreshing: Boolean, onRefresh: () -> Unit, content: @Composable () -> Unit) {
    PullToRefreshBox(refreshing, onRefresh, Modifier.fillMaxSize()) { content() }
}

/** GitHub 列表页: 汇总 + 每个仓库一张卡; 右上角同步, 下拉刷新, 返回键回上一页。 */
@Composable
fun GithubPage(state: GithubState, onBack: () -> Unit, openRepo: (String) -> Unit, onPick: () -> Unit, onAddSource: () -> Unit) {
    val context = LocalContext.current
    LaunchedEffect(Unit) {
        state.refreshIfStale(withRecent = true)
        state.mine.refreshIfStale()
        state.branches.refreshIfStale()
    }
    WatchGithub(state)
    BackHandler(onBack = onBack)
    val sync = { state.sync { Toast.makeText(context, it, Toast.LENGTH_LONG).show() } }
    GhRefreshBox(state.refreshing && state.loaded, { state.refresh(withRecent = true); state.mine.loadToday(); state.mine.loadDaily(); state.branches.load(true) }) {
        SubPage(GITHUB_TITLE, onBack, (if (state.syncing) "同步中..." else "同步") to sync) {
            state.error?.let { ErrorCard(it) }
            GithubHeatCard(state)
            TrendCard(state)
            BranchBoard(state.branches) { state.openBranchesTab = true; openRepo(it) }
            TodayCard(state.mine)
            when {
                !state.loaded -> Card { StateBody(CardState.Loading) {} }
                state.repos.isEmpty() && state.error == null -> EmptyRepos(state.synced, onPick, onAddSource)
                state.repos.isNotEmpty() -> {
                    Summary(state)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { Chip("选择仓库", false, onPick) }
                    Card { AnimatedItems(state.repos, { it.repo }) { r -> RepoCard(r, state.branches.of(r.repo)?.branches?.size ?: 0) { openRepo(r.repo) } } }
                }
            }
        }
    }
}

@Composable
private fun Summary(state: GithubState) {
    Card {
        Row(Modifier, horizontalArrangement = Arrangement.SpaceBetween) {
            SummaryCell(state.repos.size, "仓库", Modifier.weight(1f))
            SummaryCell(state.openPrs, "开放 PR", Modifier.weight(1f))
            SummaryCell(state.openIssues, "开放 Issue", Modifier.weight(1f))
            val failed = state.ciFailures
            SummaryCell(failed, "CI 失败", Modifier.weight(1f), if (failed > 0) Aioa.colors.danger else Aioa.colors.text)
        }
    }
}

@Composable
private fun EmptyRepos(synced: Boolean, onPick: () -> Unit, onAddSource: () -> Unit) {
    val c = Aioa.colors
    Card {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(ICON_GITHUB, c.textSecondary)
            Text("还没有 GitHub 仓库", c.text, GH_ROW_SP)
        }
        val hint = if (synced) "从你的仓库里勾选要显示的, 或添加 GitHub 数据源 / 配置 Webhook。" else "已有数据源但还没同步, 点右上角同步从 GitHub 回填。"
        Paragraph(hint, c.textSecondary, 13)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Chip("选择我的仓库", true, onPick)
            Chip("添加数据源", false, onAddSource)
        }
    }
}

/**
 * 一个仓库 (#138 #139): 标题行是仓库名, 星数 / PR / Issue / 未合入压到右边, 最右 CI 状态点;
 * 次行补回 "一行化" 丢的信息: CI 失败详情 (标红), 最近推送, 描述。
 */
@Composable
private fun RepoCard(repo: GhRepo, unmerged: Int, open: () -> Unit) {
    val meta = metaOf(
        if (repo.stars > 0) "★ ${repo.stars}" else "",
        if (repo.openPrs > 0) "${repo.openPrs} $LABEL_PR" else "",
        if (repo.openIssues > 0) "${repo.openIssues} $LABEL_ISSUE" else "",
        if (unmerged > 0) "$unmerged 未合入" else "",
    )
    val ci = repo.ci
    val alert = if (ci?.status == CiStatus.FAILURE) "CI 失败 · ${metaOf(ci.workflow, ci.branch, ago(ci.at))}" else ""
    val push = repo.lastPush?.let { p -> metaOf("${p.by.ifEmpty { "有人" }} 推送 ${p.commits} 个提交到 ${p.branch}", ago(p.at)) }.orEmpty()
    val sub = listOf(push, repo.description.orEmpty()).filter { it.isNotBlank() }.joinToString("\n")
    OneRow(ICON_GITHUB, repo.repo, meta, onClick = open, sub = sub, alert = alert) { Dot(ciColor(ci?.status)) }
}
