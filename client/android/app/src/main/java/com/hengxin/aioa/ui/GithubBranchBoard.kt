package com.hengxin.aioa.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Dot
import com.hengxin.aioa.kit.Paragraph
import com.hengxin.aioa.kit.Text

// 全局视图每个仓库只露几条, 其余点进仓库看
private const val PER_REPO = 3
private const val MAX_REPOS = 5
private val BAR_H = 8.dp

@Composable
fun freshColor(f: Freshness): Color = when (f) {
    Freshness.FRESH -> Aioa.colors.success
    Freshness.AGING -> Aioa.colors.warning
    Freshness.STALE -> Aioa.colors.textSecondary
}

/** 全局: 所有关注仓库里还没合入默认分支的分支, 一根新鲜度条 + 按仓库各列几条。 */
@Composable
fun BranchBoard(b: GithubBranches, openRepo: (String) -> Unit) {
    if (!b.loaded) return
    val c = Aioa.colors
    val withAny = b.repos.filter { it.branches.isNotEmpty() }
    val badge = if (b.total == 0) "全部已合入" else "${b.total} 条 · ${withAny.size} 个仓库"
    FoldCard(FOLD_BRANCHES, ICON_GITHUB, "未合入分支", badge, trailing = { Text(badge, c.textSecondary, 13) }) {
        b.error?.takeIf { b.repos.isEmpty() }?.let { Paragraph(it, c.danger, 13) }
        if (b.total == 0) return@FoldCard
        FreshBar(b.all)
        withAny.take(MAX_REPOS).forEach { r -> RepoBlock(r) { openRepo(r.repo) } }
        if (withAny.size > MAX_REPOS) Text("还有 ${withAny.size - MAX_REPOS} 个仓库, 在仓库列表里看", c.textSecondary, GH_META_SP)
    }
}

/** 一根条按新鲜度分三段, 下面一行图例带条数。 */
@Composable
private fun FreshBar(all: List<GhOpenBranch>) {
    val c = Aioa.colors
    val counts = Freshness.entries.associateWith { f -> all.count { freshnessOf(it.at) == f } }
    Row(Modifier.fillMaxWidth().height(BAR_H).clip(RoundedCornerShape(BAR_H / 2)).background(c.border)) {
        Freshness.entries.forEach { f ->
            val n = counts[f] ?: 0
            if (n > 0) Box(Modifier.weight(n.toFloat()).height(BAR_H).background(freshColor(f)))
        }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        val labels = listOf("$FRESH_DAYS 天内", "$FRESH_DAYS-$AGING_DAYS 天", "更久")
        Freshness.entries.forEachIndexed { i, f ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Dot(freshColor(f))
                Text("${labels[i]} ${counts[f] ?: 0}", c.textSecondary, GH_META_SP)
            }
        }
    }
}

@Composable
private fun RepoBlock(r: GhRepoBranches, open: () -> Unit) {
    val c = Aioa.colors
    Row(Modifier.fillMaxWidth().clickable(onClick = open).padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f)) { Text(r.repo.substringAfter('/'), c.text, 14, weight = FontWeight.Medium) }
        Text("${r.branches.size} ›", c.textSecondary, 13)
    }
    r.branches.take(PER_REPO).forEach { OpenBranchRow(it) }
    if (r.branches.size > PER_REPO) {
        Box(Modifier.clickable(onClick = open)) { Text("还有 ${r.branches.size - PER_REPO} 条", c.accent, GH_META_SP) }
    }
}

/** 一行一个分支: 点是新鲜度 (CI 失败为红), 名字, +独有 -落后, PR 号, 多久前。点开浏览器看分支。 */
@Composable
fun OpenBranchRow(b: GhOpenBranch) {
    val c = Aioa.colors
    val context = LocalContext.current
    Row(
        Modifier.fillMaxWidth().clickable { openUrl(context, b.prUrl ?: b.url) }.padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Dot(if (b.ci == CiStatus.FAILURE) c.danger else freshColor(freshnessOf(b.at)))
        Box(Modifier.weight(1f)) { Text(b.name, c.text, 14) }
        b.pr?.let { Text("#$it", c.accent, GH_META_SP) }
        Text("+${b.ahead}", c.success, GH_META_SP)
        Text("-${b.behind}", if (b.behind > 0) c.warning else c.textSecondary, GH_META_SP)
        Text(ago(b.at), c.textSecondary, GH_META_SP)
    }
}
