package com.hengxin.aioa.ui

import com.hengxin.aioa.kit.AnimatedItems
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Card
import com.hengxin.aioa.kit.CardHeader
import com.hengxin.aioa.kit.CardState
import com.hengxin.aioa.kit.Dot
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.StateBody
import com.hengxin.aioa.kit.Text

/** 总览里的 GitHub 卡: 仓库数, 开放 PR, 最新 CI, 最近几条动态; 点进 GitHub 列表页。 */
@Composable
fun GithubOverviewCard(state: GithubState, open: () -> Unit) {
    val c = Aioa.colors
    LaunchedEffect(Unit) { state.refreshIfStale(withRecent = true) }
    WatchGithub(state)
    Card(onClick = open) {
        CardHeader(ICON_GITHUB, GITHUB_TITLE)
        val shown = when {
            state.repos.isNotEmpty() -> CardState.Ready
            !state.loaded -> CardState.Loading
            state.error != null -> CardState.Error(state.error.orEmpty())
            else -> CardState.Empty
        }
        StateBody(shown, "还没有 GitHub 仓库, 点这里添加") {
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
                IconCount(ICON_GITHUB, state.repos.size, "个仓库")
                IconCount(ICON_PR, state.openPrs, "开放 PR")
            }
            val ci = state.latestCi
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Dot(ciColor(ci?.status))
                Text(ci?.let { "最新 CI " + metaOf(ciLabel(it.status), it.workflow, ago(it.at)) } ?: "最新 CI 未知", c.textSecondary, GH_META_SP)
            }
            AnimatedItems(state.recent.take(GITHUB_RECENT_SHOWN), { "${it.repo}${it.ts}${it.title}" }) { a ->
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(activityIcon(a.kind), c.textSecondary, 14.dp)
                    Text("${a.repo.substringAfter('/')}: ${a.title}", c.text, 13)
                }
            }
        }
    }
}
