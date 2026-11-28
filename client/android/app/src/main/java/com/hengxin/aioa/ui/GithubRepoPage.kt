package com.hengxin.aioa.ui

import com.hengxin.aioa.kit.AnimatedItems
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.CardState
import com.hengxin.aioa.kit.Chip
import com.hengxin.aioa.kit.Dot
import com.hengxin.aioa.kit.Paragraph
import com.hengxin.aioa.kit.StateBody
import com.hengxin.aioa.kit.Text

private enum class RepoTab(val label: String) { TIMELINE("动态"), HISTORY("历史"), BRANCHES("未合入"), PRS(LABEL_PR), ISSUES(LABEL_ISSUE), CI(LABEL_CI) }

/** 仓库详情: 分段看动态, PR, Issue, CI; 每条点开浏览器, 返回键回列表。 */
@Composable
fun GithubRepoPage(state: GithubState, repo: String, onBack: () -> Unit) {
    val context = LocalContext.current
    var tab by rememberSaveable(repo) { mutableStateOf(if (state.openBranchesTab) RepoTab.BRANCHES else RepoTab.TIMELINE) }
    LaunchedEffect(repo) {
        state.openBranchesTab = false
        state.loadDetail(repo)
        state.branches.refreshIfStale()
    }
    val open = state.branches.of(repo)?.takeIf { it.error == null }?.branches
    WatchGithub(state, repo)
    BackHandler(onBack = onBack)
    val detail = state.details[repo]
    val summary = detail?.repo ?: state.repos.firstOrNull { it.repo == repo }
    val url = summary?.url?.ifEmpty { null } ?: GH_WEB_ROOT + repo
    var reload by rememberSaveable(repo) { mutableIntStateOf(0) }
    GhRefreshBox(false, { state.loadDetail(repo); reload++ }) {
        SubPage(repo.substringAfter('/'), onBack, "在 GitHub 打开" to { openUrl(context, url) }) {
            summary?.let { RepoHeader(it) }
            RepoTrendCard(repo, reload)
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                RepoTab.entries.forEach { t -> Chip(t.label + count(detail, t, open), tab == t) { tab = t } }
            }
            val error = state.detailErrors[repo]
            if (tab == RepoTab.HISTORY) FoldCard(FOLD_REPO_LIST, tabIcon(tab), tab.label) { HistoryTab(state.history, repo) { openUrl(context, it) } }
            else FoldCard(FOLD_REPO_LIST, tabIcon(tab), tab.label + count(detail, tab, open)) {
                val shown = when {
                    detail != null -> if (rows(detail, tab, open) == 0) CardState.Empty else CardState.Ready
                    error != null -> CardState.Error(error)
                    else -> CardState.Loading
                }
                StateBody(shown, emptyText(tab, open != null), { state.loadDetail(repo) }) {
                    if (detail != null) TabBody(detail, tab, open) { openUrl(context, it) }
                }
            }
        }
    }
}

@Composable
private fun RepoHeader(r: GhRepo) {
    val c = Aioa.colors
    FoldCard(FOLD_REPO_HEAD, if (r.fork) ICON_FORK else ICON_GITHUB, r.repo, repoOrigin(r.fork, r.parent)) {
        // fork / 自建 (#144): fork 写上游
        Text(repoOrigin(r.fork, r.parent), c.textSecondary, GH_META_SP)
        r.description?.let { Paragraph(it, c.text, 14) }
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
            IconCount(ICON_STAR, r.stars, "星")
            IconCount(ICON_PR, r.openPrs, LABEL_PR)
            IconCount(ICON_ISSUE, r.openIssues, LABEL_ISSUE)
        }
        CiLine(r.ci)
        pushLine(r.lastPush)?.let { Text(it, c.textSecondary, GH_META_SP) }
    }
}

@Composable
private fun TabBody(d: GhDetail, tab: RepoTab, unmerged: List<GhOpenBranch>?, open: (String?) -> Unit) {
    when (tab) {
        RepoTab.TIMELINE -> AnimatedItems(d.timeline.sortedByDescending { it.ts }, { "${it.ts}${it.kind}${it.title}" }) { a ->
            GhRow(activityIcon(a.kind), a.title, ago(a.ts)) { open(a.url) }
        }
        RepoTab.PRS -> AnimatedItems(d.prs, { it.number }) { p ->
            val meta = metaOf("#${p.number}", p.author, if (p.draft) "草稿" else "", ago(p.updatedAt))
            GhRow(ICON_PR, p.title, meta) { open(p.url) }
        }
        RepoTab.ISSUES -> AnimatedItems(d.issues, { it.number }) { i ->
            val meta = metaOf("#${i.number}", i.author, ago(i.updatedAt), *i.labels.toTypedArray())
            GhRow(ICON_ISSUE, i.title, meta) { open(i.url) }
        }
        RepoTab.CI -> AnimatedItems(d.runs, { it.url }) { r -> RunRow(r) { open(r.url) } }
        RepoTab.HISTORY -> Unit
        // 有 GITHUB_TOKEN 时列未合入分支, 否则退回 webhook 收到过推送的分支
        RepoTab.BRANCHES -> if (unmerged != null) AnimatedItems(unmerged, { it.name }) { b -> OpenBranchRow(b) }
        else AnimatedItems(d.branches, { it.name }) { b -> BranchRow(b) { open("${d.repo.url}/tree/${b.name}") } }
    }
}

/** 一行一个分支: 名字, 谁多久前推了几个提交, 前面的点是该分支最近 CI 的颜色 (没有 CI 记录为灰)。 */
@Composable
private fun BranchRow(b: GhBranch, onClick: () -> Unit) {
    val c = Aioa.colors
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Dot(ciColor(b.ci))
        val meta = metaOf(b.by, "${b.commits} 个提交", b.sha.orEmpty(), b.ci?.let(::ciLabel).orEmpty(), ago(b.at))
        GhRow("git-branch", b.name, meta, c.textSecondary, onClick)
    }
}

@Composable
private fun RunRow(r: GhRun, onClick: () -> Unit) {
    val c = Aioa.colors
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Dot(ciColor(r.status))
        val meta = metaOf(r.branch, ciLabel(r.status), ago(r.at))
        GhRow(ICON_RUN, r.workflow.ifEmpty { LABEL_CI }, meta, c.textSecondary, onClick)
    }
}

private fun tabIcon(tab: RepoTab): String = when (tab) {
    RepoTab.TIMELINE -> "activity"
    RepoTab.HISTORY -> "folder"
    RepoTab.BRANCHES -> "git-branch"
    RepoTab.PRS -> ICON_PR
    RepoTab.ISSUES -> ICON_ISSUE
    RepoTab.CI -> ICON_RUN
}

private fun rows(d: GhDetail, tab: RepoTab, unmerged: List<GhOpenBranch>?): Int = when (tab) {
    RepoTab.TIMELINE -> d.timeline.size
    RepoTab.HISTORY -> 0
    RepoTab.PRS -> d.prs.size
    RepoTab.ISSUES -> d.issues.size
    RepoTab.CI -> d.runs.size
    RepoTab.BRANCHES -> unmerged?.size ?: d.branches.size
}

private fun count(d: GhDetail?, tab: RepoTab, unmerged: List<GhOpenBranch>?): String = if (d == null || tab == RepoTab.TIMELINE || tab == RepoTab.HISTORY) "" else " ${rows(d, tab, unmerged)}"

private fun emptyText(tab: RepoTab, live: Boolean): String = when (tab) {
    RepoTab.TIMELINE -> "还没有动态, 配好 Webhook 后这里会实时出现; 更早的在历史里"
    RepoTab.HISTORY -> ""
    RepoTab.PRS -> "没有开放的 PR"
    RepoTab.ISSUES -> "没有开放的 Issue"
    RepoTab.CI -> "还没有 CI 记录"
    RepoTab.BRANCHES -> if (live) "所有分支都已合入默认分支" else "还没有收到推送; 配好 Webhook 后, 推送过的分支会按时间列在这里"
}
