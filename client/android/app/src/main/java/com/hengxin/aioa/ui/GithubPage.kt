package com.hengxin.aioa.ui

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
fun GithubPage(state: GithubState, onBack: () -> Unit, openRepo: (String) -> Unit, onAddSource: () -> Unit) {
    val context = LocalContext.current
    LaunchedEffect(Unit) { state.refresh(withRecent = true) }
    WatchGithub(state)
    BackHandler(onBack = onBack)
    val sync = { state.sync { Toast.makeText(context, it, Toast.LENGTH_LONG).show() } }
    GhRefreshBox(state.refreshing && state.loaded, { state.refresh(withRecent = true) }) {
        SubPage(GITHUB_TITLE, onBack, (if (state.syncing) "同步中..." else "同步") to sync) {
            state.error?.let { ErrorCard(it) }
            when {
                !state.loaded -> Card { StateBody(CardState.Loading) {} }
                state.repos.isEmpty() && state.error == null -> EmptyRepos(state.synced, onAddSource)
                state.repos.isNotEmpty() -> {
                    Summary(state)
                    state.repos.forEach { RepoCard(it) { openRepo(it.repo) } }
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
private fun EmptyRepos(synced: Boolean, onAddSource: () -> Unit) {
    val c = Aioa.colors
    Card {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(ICON_GITHUB, c.textSecondary)
            Text("还没有 GitHub 仓库", c.text, GH_ROW_SP)
        }
        val hint = if (synced) "添加一个 GitHub 数据源 (填 owner/repo), 或在仓库里配置 Webhook。" else "已有数据源但还没同步, 点右上角同步从 GitHub 回填。"
        Paragraph(hint, c.textSecondary, 13)
        Chip("添加 GitHub", true, onAddSource)
    }
}

@Composable
private fun RepoCard(repo: GhRepo, open: () -> Unit) {
    val c = Aioa.colors
    Card(onClick = open) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(ICON_GITHUB, c.textSecondary, 16.dp)
            Box(Modifier.weight(1f)) { Text(repo.repo, c.text, GH_ROW_SP, weight = FontWeight.Medium) }
            Icon(ICON_STAR, c.textSecondary, 14.dp)
            Text("${repo.stars}", c.textSecondary, 13)
        }
        repo.description?.let { Paragraph(it, c.textSecondary, 13, maxLines = 2) }
        CiLine(repo.ci)
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            IconCount(ICON_PR, repo.openPrs, LABEL_PR)
            IconCount(ICON_ISSUE, repo.openIssues, LABEL_ISSUE)
        }
        pushLine(repo.lastPush)?.let {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Icon("git-commit-horizontal", c.textSecondary, 14.dp)
                Text(it, c.textSecondary, GH_META_SP)
            }
        }
    }
}
