package com.hengxin.aioa.ui.todo

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.browser.Browser
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.TodoRow

private const val GITHUB = "https://github.com/"
private val FIELD = RoundedCornerShape(12.dp)
private val SEG = RoundedCornerShape(10.dp)
private val PRIOS = listOf(1 to "P1 紧急", 2 to "P2 普通", 3 to "P3 以后")

/** 待办详情: 四态切换, 优先级, 创建时间与来源消息, 关联的 issue (内置浏览器打开)。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TodoSheet(r: TodoRow, all: List<TodoRow>, close: () -> Unit, setState: (String) -> Unit, setPrio: (Int) -> Unit, jump: (Long) -> Unit) {
    val c = Aioa.colors
    val context = LocalContext.current
    ModalBottomSheet(close, containerColor = c.surface) {
        Column(Modifier.navigationBarsPadding().padding(horizontal = 18.dp).padding(bottom = 18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(r.title, color = c.text, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
            Segments(STATES.map { it to stateLabel(it) }, if (r.state == TodoRow.STATE_DROPPED) TodoRow.STATE_DONE else r.state, setState)
            Segments(PRIOS, r.prio, setPrio)
            val created = if (r.created > 0) "${dayOf(r.created)} ${clock(r.created)}" else "未知"
            Field("创建", created + if (r.src != null) " · 来源消息" else "", if (r.src != null) "chevron-right" else null) { r.src?.let(jump) }
            r.doneAt?.takeIf { r.finished }?.let { Field("完成", "${dayOf(it)} ${clock(it)}") }
            if (r.repo != null && r.issue != null) {
                val st = when (r.ghOpen) {
                    null -> "未同步"
                    false -> "已关闭"
                    else -> if (r.ghComments > 0) "打开 · ${r.ghComments} 评论" else "打开"
                }
                Field("issue", "${r.repo}#${r.issue} · $st", "external-link") { Browser.open(context, "$GITHUB${r.repo}/issues/${r.issue}") }
            } else r.repo?.let { Field("仓库", it) }
            val parent = r.parent?.let { p -> all.find { it.id == p } } ?: r.ghParent?.let { n -> all.find { it.repo == r.repo && it.issue == n } }
            parent?.let { Field("父任务", it.title) }
            r.note?.let { Text(it, color = c.textSecondary, fontSize = 13.sp, lineHeight = 19.sp) }
            if (r.issue != null) Text("issue 关闭后自动完成, 有评论自动变进行中; 这里手动改不会动 GitHub。", color = c.textSecondary, fontSize = 12.sp)
        }
    }
}

@Composable
private fun <T> Segments(options: List<Pair<T, String>>, current: T, pick: (T) -> Unit) {
    val c = Aioa.colors
    Row(Modifier.fillMaxWidth().clip(SEG).background(c.surfaceAlt).padding(3.dp)) {
        options.forEach { (v, label) ->
            val on = v == current
            val tint = (v as? String)?.let { stateColor(it) } ?: c.accent
            Text(
                label,
                Modifier.weight(1f).clip(RoundedCornerShape(8.dp)).background(if (on) c.surface else Color.Transparent).clickable { if (!on) pick(v) }.padding(vertical = 8.dp),
                color = if (on) tint else c.textSecondary,
                fontSize = 13.sp,
                fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
        }
    }
}

@Composable
private fun Field(key: String, value: String, icon: String? = null, onClick: (() -> Unit)? = null) {
    val c = Aioa.colors
    Row(Modifier.fillMaxWidth().clip(FIELD).background(c.surfaceAlt).clickable(enabled = onClick != null) { onClick?.invoke() }.padding(horizontal = 12.dp, vertical = 11.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(key, Modifier.width(52.dp), color = c.textSecondary, fontSize = 12.sp)
        Text(value, Modifier.weight(1f), color = c.text, fontSize = 14.sp, maxLines = 2)
        icon?.let { Icon(it, c.textSecondary, 16.dp) }
    }
}

/** 筛选: 仓库多选, 显示已完成, 只看有 issue, 优先级。改了立即生效并记住。 */
@OptIn(ExperimentalMaterial3Api::class, androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
fun FilterSheet(f: TodoFilter, repos: List<String>, set: (TodoFilter) -> Unit, close: () -> Unit) {
    val c = Aioa.colors
    ModalBottomSheet(close, containerColor = c.surface) {
        Column(Modifier.navigationBarsPadding().padding(horizontal = 18.dp).padding(bottom = 18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("筛选", color = c.text, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
            Label("仓库 (不选为全部)")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                repos.forEach { repo ->
                    val on = repo in f.repos
                    SheetChip(if (repo == NO_REPO) repo else repoName(repo), on, repoColor(repo)) { set(f.copy(repos = if (on) f.repos - repo else f.repos + repo)) }
                }
            }
            Label("显示")
            Toggle("显示已完成", "打开后划掉显示", f.showDone) { set(f.copy(showDone = it)) }
            Toggle("只看关联了 issue 的", null, f.onlyIssue) { set(f.copy(onlyIssue = it)) }
            Label("优先级")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PRIOS.forEach { (p, label) ->
                    val on = p in f.prios
                    SheetChip(label, on, c.accent) { if (!on || f.prios.size > 1) set(f.copy(prios = if (on) f.prios - p else f.prios + p)) }
                }
            }
        }
    }
}

@Composable
private fun Label(text: String) = Text(text, Modifier.padding(top = 8.dp), color = Aioa.colors.textSecondary, fontSize = 12.sp)

@Composable
private fun SheetChip(label: String, on: Boolean, dot: Color, onClick: () -> Unit) {
    val c = Aioa.colors
    Row(Modifier.clip(RoundedCornerShape(50)).background(if (on) c.accent.copy(alpha = 0.12f) else c.surfaceAlt).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        androidx.compose.foundation.layout.Box(Modifier.padding(end = 6.dp).clip(RoundedCornerShape(2.dp)).background(dot).padding(4.dp))
        Text(label, color = if (on) c.accent else c.text, fontSize = 13.sp, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal)
        if (on) Icon("check", c.accent, 14.dp, Modifier.padding(start = 4.dp))
    }
}

@Composable
private fun Toggle(title: String, hint: String?, on: Boolean, set: (Boolean) -> Unit) {
    val c = Aioa.colors
    Row(Modifier.fillMaxWidth().clickable { set(!on) }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, color = c.text, fontSize = 15.sp)
            hint?.let { Text(it, color = c.textSecondary, fontSize = 12.sp) }
        }
        Switch(on, set)
    }
}
