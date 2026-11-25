package com.hengxin.aioa.ui.todo

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.TodoRow
import com.hengxin.aioa.kit.pressable
import com.hengxin.aioa.ui.SpacesState

private const val PAD = 14
private const val INDENT = 22
private val CARD = RoundedCornerShape(14.dp)
private val PILL = RoundedCornerShape(50)
private const val CHIP_ALPHA = 0.12f
private const val PRIO_URGENT = 1

/** 待办看板: 日期 / 仓库两个维度互换, 父子树可折叠, 默认藏已完成。数据和实时同步来自 SpacesState。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TodoBoard(spaces: SpacesState, channel: String, onJump: (Long) -> Unit, modifier: Modifier = Modifier) {
    val c = Aioa.colors
    val context = LocalContext.current
    val saved = remember(channel) { TodoFilter.load(context, channel) }
    var filter by remember(channel) { mutableStateOf(saved.first) }
    var axis by remember(channel) { mutableStateOf(saved.second) }
    LaunchedEffect(filter, axis) { TodoFilter.save(context, channel, filter, axis) }
    // 折叠的分组 / 父节点; 父节点默认展开
    var closed by rememberSaveable(channel) { mutableStateOf(setOf<String>()) }
    var picked by remember { mutableStateOf<String?>(null) }
    var sheet by remember { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }
    val rows = spaces.todos(channel)
    val repos = remember(rows) { rows.orEmpty().map { it.repo ?: NO_REPO }.distinct().sortedWith(compareBy<String> { it == NO_REPO }.thenBy { it.lowercase() }) }
    val shown = remember(rows, filter) { rows.orEmpty().filter(filter::keep) }
    val secs = remember(shown, axis) { sections(shown, axis) }
    val toggle = { k: String -> closed = if (k in closed) closed - k else closed + k }
    Column(modifier.background(c.background)) {
        AxisSwitch(axis) { axis = it }
        FilterBar(filter, repos.size, { sheet = true }) { filter = filter.copy(showDone = !filter.showDone) }
        PullToRefreshBox(refreshing, { refreshing = true; spaces.syncTodos(channel) { refreshing = false } }, Modifier.fillMaxSize()) {
            if (rows == null) return@PullToRefreshBox Empty("加载中...")
            if (secs.isEmpty()) return@PullToRefreshBox Empty(if (rows.isEmpty()) "还没有待办, 在群里丢个想法吧" else "筛选后没有待办")
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = PAD.dp, end = PAD.dp, bottom = 24.dp)) {
                for (s in secs) section(s, closed, toggle, { picked = it.id }) { r -> spaces.setTodo(channel, r, !r.finished) }
            }
        }
    }
    picked?.let { id -> rows?.find { it.id == id } }?.let { r ->
        TodoSheet(r, rows.orEmpty(), { picked = null }, { s -> spaces.setState(channel, r, s) }, { p -> spaces.setPrio(channel, r, p) }) { seq -> picked = null; onJump(seq) }
    }
    if (sheet) FilterSheet(filter, repos, { filter = it }) { sheet = false }
}

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
private fun LazyListScope.section(s: TodoSection, closed: Set<String>, toggle: (String) -> Unit, open: (TodoRow) -> Unit, tick: (TodoRow) -> Unit) {
    stickyHeader(key = "s:${s.key}") { SectionHeader(s) }
    for (g in s.groups) {
        item(key = "g:${g.key}") {
            val c = Aioa.colors
            val shut = g.key in closed
            Column(Modifier.fillMaxWidth().padding(bottom = 10.dp).clip(CARD).background(c.surface).animateContentSize()) {
                Row(Modifier.fillMaxWidth().clickable { toggle(g.key) }.padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (g.repo != null) Box(Modifier.size(8.dp).clip(RoundedCornerShape(2.dp)).background(repoColor(g.repo)))
                    else Icon("calendar-days", c.textSecondary, 14.dp)
                    Text(g.title, Modifier.padding(start = 8.dp).weight(1f), color = c.text, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("${g.count}", color = c.textSecondary, fontSize = 12.sp)
                    Icon(if (shut) "chevron-right" else "chevron-down", c.textSecondary, 16.dp, Modifier.padding(start = 6.dp))
                }
                if (!shut) g.nodes.forEach { NodeRows(it, 0, closed, toggle, open, tick = tick) }
            }
        }
    }
}

@Composable
private fun SectionHeader(s: TodoSection) {
    val c = Aioa.colors
    Row(Modifier.fillMaxWidth().background(c.background).padding(start = 2.dp, top = 12.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        if (s.repo != null) {
            Box(Modifier.size(9.dp).clip(RoundedCornerShape(2.dp)).background(repoColor(s.repo)))
            Spacer(Modifier.width(7.dp))
        }
        Text(s.title, color = c.text, fontSize = 15.sp, fontWeight = FontWeight.Bold)
        Text(s.sub, Modifier.padding(start = 8.dp), color = c.textSecondary, fontSize = 12.sp)
    }
}

@Composable
internal fun NodeRows(n: TodoNode, depth: Int, closed: Set<String>, toggle: (String) -> Unit, open: (TodoRow) -> Unit, showRepo: Boolean = false, tick: (TodoRow) -> Unit) {
    val c = Aioa.colors
    val r = n.row
    val key = "n:${r.id}"
    val parent = n.kids.isNotEmpty()
    val shut = key in closed
    Box(Modifier.fillMaxWidth().padding(start = (12 + depth * INDENT).dp).height(0.5.dp).background(c.border))
    Row(Modifier.fillMaxWidth().pressable { open(r) }.padding(start = (12 + depth * INDENT).dp, end = 12.dp, top = 9.dp, bottom = 9.dp), verticalAlignment = Alignment.Top) {
        if (parent) {
            Box(Modifier.size(20.dp).clip(PILL).clickable { toggle(key) }, contentAlignment = Alignment.Center) { Icon(if (shut) "chevron-right" else "chevron-down", c.textSecondary, 16.dp) }
        } else {
            Box(Modifier.size(20.dp).clip(RoundedCornerShape(6.dp)).clickable { tick(r) }, contentAlignment = Alignment.Center) {
                Icon(if (r.finished) "square-check" else "square", if (r.finished) c.success else c.textSecondary, 19.dp)
            }
        }
        Column(Modifier.padding(start = 10.dp).weight(1f)) {
            Text(
                r.title,
                color = if (r.finished) c.textSecondary else c.text,
                fontSize = 14.sp,
                textDecoration = if (r.finished) TextDecoration.LineThrough else null,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            MetaLine(r, showRepo)
        }
        if (parent) Text("${n.done}/${n.total}", Modifier.padding(start = 6.dp).clip(PILL).background(c.surfaceAlt).padding(horizontal = 6.dp, vertical = 1.dp), color = c.textSecondary, fontSize = 11.sp)
    }
    if (parent && !shut) n.kids.forEach { NodeRows(it, depth + 1, closed, toggle, open, showRepo, tick) }
}

@Composable
private fun MetaLine(r: TodoRow, showRepo: Boolean = false) {
    val c = Aioa.colors
    Row(Modifier.padding(top = 3.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        // 总览的待办组件不按仓库分组, 每条标出仓库
        if (showRepo) r.repo?.let { repo ->
            Box(Modifier.size(7.dp).clip(RoundedCornerShape(2.dp)).background(repoColor(repo)))
            Text(repoName(repo), color = c.textSecondary, fontSize = 11.sp)
        }
        if (!r.finished) Text("P${r.prio}", color = if (r.prio == PRIO_URGENT) c.danger else c.textSecondary, fontSize = 11.sp)
        stateColor(r.state)?.let { Pill(stateLabel(r.state), it) }
        r.issue?.let { n -> Pill("#$n", if (r.ghOpen == false) DONE_PURPLE else c.success, if (r.ghOpen == false) "circle-check" else "circle-dot") }
        if (r.ghComments > 0 && r.ghOpen != false) Text("${r.ghComments} 评论", color = c.textSecondary, fontSize = 11.sp)
        val time = r.doneAt?.takeIf { r.finished }?.let { "${shortDay(it)} ${clock(it)} 完成" } ?: r.created.takeIf { it > 0 }?.let { "${clock(it)} 创建" }
        time?.let { Text(it, color = c.textSecondary, fontSize = 11.sp) }
    }
}

private val DONE_PURPLE = Color(0xFF8250DF)

@Composable
internal fun stateColor(s: String): Color? = when (s) {
    TodoRow.STATE_DOING -> Aioa.colors.accent
    TodoRow.STATE_HOLD -> Aioa.colors.warning
    else -> null
}

@Composable
internal fun Pill(text: String, color: Color, icon: String? = null) {
    Row(Modifier.clip(PILL).background(color.copy(alpha = CHIP_ALPHA)).padding(horizontal = 6.dp, vertical = 1.dp), verticalAlignment = Alignment.CenterVertically) {
        icon?.let { Icon(it, color, 11.dp); Spacer(Modifier.width(3.dp)) }
        Text(text, color = color, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun AxisSwitch(axis: TodoAxis, set: (TodoAxis) -> Unit) {
    val c = Aioa.colors
    Row(Modifier.fillMaxWidth().padding(horizontal = PAD.dp, vertical = 8.dp).clip(RoundedCornerShape(10.dp)).background(c.surfaceAlt).padding(3.dp)) {
        for ((a, label, icon) in listOf(Triple(TodoAxis.DATE, "按日期", "calendar-days"), Triple(TodoAxis.REPO, "按仓库", "folder"))) {
            val on = a == axis
            Row(
                Modifier.weight(1f).clip(RoundedCornerShape(8.dp)).background(if (on) c.surface else Color.Transparent).clickable { set(a) }.padding(vertical = 7.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(icon, if (on) c.text else c.textSecondary, 14.dp)
                Text(label, Modifier.padding(start = 5.dp), color = if (on) c.text else c.textSecondary, fontSize = 13.sp, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal)
            }
        }
    }
}

@Composable
private fun FilterBar(f: TodoFilter, repoCount: Int, openSheet: () -> Unit, toggleDone: () -> Unit) {
    val repoLabel = if (f.repos.isEmpty()) "全部仓库" else if (f.repos.size == 1) repoName(f.repos.first()) else "${f.repos.size}/$repoCount 个仓库"
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = PAD.dp).padding(bottom = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        BarChip("folder", repoLabel, f.repos.isNotEmpty(), openSheet)
        BarChip(if (f.showDone) "eye" else "eye-off", if (f.showDone) "已完成 显示" else "已完成 隐藏", f.showDone, toggleDone)
        BarChip("sliders-horizontal", "筛选", f.onlyIssue || f.prios.size < 3, openSheet)
    }
}

@Composable
private fun BarChip(icon: String, label: String, on: Boolean, onClick: () -> Unit) {
    val c = Aioa.colors
    Row(
        Modifier.clip(PILL).background(if (on) c.accent.copy(alpha = CHIP_ALPHA) else c.surface).border(0.5.dp, c.border, PILL).clickable(onClick = onClick).padding(horizontal = 11.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, if (on) c.accent else c.textSecondary, 14.dp)
        Text(label, Modifier.padding(start = 5.dp), color = if (on) c.accent else c.text, fontSize = 13.sp)
    }
}

@Composable
private fun Empty(text: String) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text(text, color = Aioa.colors.textSecondary, fontSize = 13.sp) }
}

@Composable
private fun Text(
    text: String,
    modifier: Modifier = Modifier,
    color: Color,
    fontSize: androidx.compose.ui.unit.TextUnit,
    fontWeight: FontWeight? = null,
    textDecoration: TextDecoration? = null,
    maxLines: Int = 1,
    overflow: TextOverflow = TextOverflow.Ellipsis,
) = androidx.compose.material3.Text(text, modifier, color = color, fontSize = fontSize, fontWeight = fontWeight, textDecoration = textDecoration, maxLines = maxLines, overflow = overflow)

/** 待办群顶上的 聊天 / 待办 切换。 */
@Composable
fun ChatTodoTabs(todo: Boolean, set: (Boolean) -> Unit) {
    val c = Aioa.colors
    Row(Modifier.fillMaxWidth().padding(horizontal = PAD.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        for ((on, label, icon) in listOf(Triple(false, "聊天", "message-circle"), Triple(true, "待办", "list-checks"))) {
            val sel = on == todo
            Row(
                Modifier.clip(PILL).background(if (sel) c.accent else c.surfaceAlt).clickable { set(on) }.padding(horizontal = 14.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(icon, if (sel) c.onAccent else c.textSecondary, 14.dp)
                Text(label, Modifier.padding(start = 5.dp), color = if (sel) c.onAccent else c.text, fontSize = 13.sp, fontWeight = if (sel) FontWeight.SemiBold else FontWeight.Normal)
            }
        }
    }
}
