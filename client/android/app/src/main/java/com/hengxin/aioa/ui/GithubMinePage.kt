package com.hengxin.aioa.ui

import com.hengxin.aioa.kit.AnimatedItems
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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
import com.hengxin.aioa.kit.pressable

// 今日卡片里最多列几条, 其余收进 "还有 N 条"
private const val TODAY_SHOWN = 8

/** GitHub 页顶部: 今天我做了什么 (推送, 提交, PR, Issue) 与最近几条动态。 */
@Composable
fun TodayCard(mine: GithubMine) {
    val context = LocalContext.current
    val c = Aioa.colors
    val t = mine.today ?: return
    var expanded by remember { mutableStateOf(false) }
    Card {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon("github", c.textSecondary, 16.dp)
            Box(Modifier.weight(1f)) { Text("今天" + if (t.login.isNotEmpty()) " · ${t.login}" else "", c.text, GH_ROW_SP, weight = FontWeight.Medium) }
        }
        Row(Modifier, horizontalArrangement = Arrangement.SpaceBetween) {
            SummaryCell(t.stats.pushes, "推送", Modifier.weight(1f))
            SummaryCell(t.stats.prs, LABEL_PR, Modifier.weight(1f))
            SummaryCell(t.stats.issues, LABEL_ISSUE, Modifier.weight(1f))
            SummaryCell(t.stats.repos, "仓库", Modifier.weight(1f))
        }
        if (t.items.isEmpty()) Paragraph("今天还没有动静。", c.textSecondary, 13)
        val shown = if (expanded) t.items else t.items.take(TODAY_SHOWN)
        AnimatedItems(shown, { it.id }) { a -> GhRow(activityIcon(a.kind), a.title, metaOf(a.repo, ago(a.ts))) { openUrl(context, a.url) } }
        if (!expanded && t.items.size > TODAY_SHOWN) Chip("还有 ${t.items.size - TODAY_SHOWN} 条", false) { expanded = true }
    }
}

/** 选择仓库: 列出账号下的仓库, 勾选要在 GitHub 页显示的, 保存后整体替换。 */
@Composable
fun GithubPickPage(state: GithubState, onBack: () -> Unit) {
    val context = LocalContext.current
    val mine = state.mine
    val c = Aioa.colors
    LaunchedEffect(Unit) { mine.loadPicks() }
    BackHandler(onBack = onBack)
    // 初次加载完成后以服务端的勾选为准, 之后由用户改
    var selected by remember { mutableStateOf<Set<String>?>(null) }
    LaunchedEffect(mine.picks) { if (selected == null && mine.picks.isNotEmpty()) selected = mine.picks.filter { it.tracked }.map { it.repo }.toSet() }
    val chosen = selected.orEmpty()
    val save = {
        mine.save(chosen) { err ->
            if (err != null) Toast.makeText(context, err, Toast.LENGTH_LONG).show()
            else {
                state.sync { Toast.makeText(context, it, Toast.LENGTH_LONG).show() }
                onBack()
            }
        }
    }
    SubPage("选择仓库", onBack, (if (mine.saving) "保存中..." else "保存 (${chosen.size})") to save) {
        mine.pickError?.let { ErrorCard(it) }
        when {
            mine.loadingPicks && mine.picks.isEmpty() -> Card { StateBody(CardState.Loading) {} }
            mine.picks.isEmpty() && mine.pickError == null -> Card { Paragraph("没有读到仓库, 检查服务端的 GITHUB_TOKEN 能否访问你的仓库。", c.textSecondary, 13) }
            else -> Card {
                if (mine.login.isNotEmpty()) Text("${mine.login} 的仓库, 按最近推送排序", c.textSecondary, GH_META_SP)
                mine.picks.forEach { p ->
                    val on = p.repo in chosen
                    Row(
                        Modifier.fillMaxWidth().pressable { selected = if (on) chosen - p.repo else chosen + p.repo }.padding(vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Icon(if (on) "check" else ICON_GITHUB, if (on) c.accent else c.textSecondary, 16.dp)
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Paragraph(p.repo + if (p.private) " (私有)" else "", if (on) c.text else c.textSecondary, 14, maxLines = 1)
                            p.description?.let { Text(it, c.textSecondary, 11) }
                        }
                    }
                }
            }
        }
    }
}
