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
import androidx.compose.runtime.CompositionLocalProvider
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
import com.hengxin.aioa.ui.ALL_TODOS
import com.hengxin.aioa.ui.SpacesState

private const val PAD = 14
private val CARD = RoundedCornerShape(14.dp)
private val PILL = RoundedCornerShape(50)

/**
 * 待办看板 (点子待办空间整页, 群里的 "待办" 页, 总览全屏看板同一个, #152): 看板 (按状态分列) 与 分区 / 截止 / 日期 / 仓库 四种列表,
 * 父子树可折叠, 父项显示全部子孙进度, 默认藏已完成。
 * channel 为 null 时看本账号全部群的待办; 群里可在 "本群 / 全部" 间切换。右下角新建 (生活事务不必经过群)。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TodoBoard(spaces: SpacesState, channel: String?, onJump: (String, Long) -> Unit, modifier: Modifier = Modifier) {
    val c = Aioa.colors
    val context = LocalContext.current
    val prefsKey = channel ?: ALL_TODOS
    val saved = remember(prefsKey) { TodoFilter.load(context, prefsKey) }
    var filter by remember(prefsKey) { mutableStateOf(saved.first) }
    var axis by remember(prefsKey) { mutableStateOf(saved.second) }
    var everywhere by rememberSaveable(prefsKey) { mutableStateOf(channel == null) }
    LaunchedEffect(filter, axis) { TodoFilter.save(context, prefsKey, filter, axis) }
    // 折叠的分组 / 父节点; 父节点默认展开
    var closed by rememberSaveable(prefsKey) { mutableStateOf(setOf<String>()) }
    var picked by remember { mutableStateOf<Pair<String, String>?>(null) }
    var editing by remember { mutableStateOf<TodoRow?>(null) }
    var sheet by remember { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }
    val rows = if (everywhere || channel == null) spaces.allTodos() else spaces.todos(channel)
    val repos = remember(rows) { rows.orEmpty().map { it.repo ?: NO_REPO }.distinct().sortedWith(compareBy<String> { it == NO_REPO }.thenBy { it.lowercase() }) }
    val areas = remember(rows) { areasOf(rows.orEmpty()) }
    val shown = remember(rows, filter) { rows.orEmpty().filter(filter::keep) }
    val now = rememberNow()
    // 截止分桶 (今天 / 明天) 跟着时间走
    val all = rows.orEmpty()
    val secs = remember(shown, axis, now) { if (axis == TodoAxis.STATE) emptyList() else sections(shown, axis, all) }
    val cols = remember(shown, axis) { if (axis == TodoAxis.STATE) stateColumns(shown, all) else emptyList() }
    val toggle = { k: String -> closed = if (k in closed) closed - k else closed + k }
    Box(modifier.background(c.background)) {
        Column(Modifier.fillMaxSize()) {
            if (channel != null) ScopeSwitch(everywhere) { everywhere = it }
            AxisSwitch(axis) { axis = it }
            FilterBar(filter, { sheet = true }, { filter = filter.copy(onlyStar = !filter.onlyStar) }) { filter = filter.copy(showDone = !filter.showDone) }
            PullToRefreshBox(refreshing, { refreshing = true; spaces.syncTodos(channel ?: rows?.firstOrNull()?.channel ?: DEFAULT_TODO_GROUP) { refreshing = false } }, Modifier.fillMaxSize()) {
                if (rows == null) return@PullToRefreshBox Empty("加载中...")
                val pick = { r: TodoRow -> picked = r.channel to r.id }
                val tick = { r: TodoRow -> spaces.setTodo(r.channel, r, !r.finished) }
                if (axis == TodoAxis.STATE && rows.isNotEmpty()) return@PullToRefreshBox CompositionLocalProvider(LocalNow provides now) {
                    TodoKanban(cols, closed, toggle, everywhere, pick, tick)
                }
                if (secs.isEmpty()) return@PullToRefreshBox Empty(if (rows.isEmpty()) "还没有待办, 点右下角新建, 或在群里丢个想法" else "筛选后没有待办")
                CompositionLocalProvider(LocalNow provides now) {
                    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = PAD.dp, end = PAD.dp, bottom = 88.dp)) {
                        for (s in secs) section(s, closed, toggle, everywhere, pick, tick)
                    }
                }
            }
        }
        UndoBar(spaces, Modifier.align(Alignment.BottomStart).padding(start = 14.dp, end = 84.dp, bottom = 22.dp))
        AddButton(Modifier.align(Alignment.BottomEnd).padding(18.dp)) {
            val group = channel?.takeIf { !everywhere } ?: homeGroup(rows.orEmpty())
            editing = TodoRow(newTodoId(), "", null, TodoRow.STATE_OPEN, 2, null, 0, channel = group, area = filter.areas.singleOrNull()?.takeIf { it != TodoRow.AREA_NONE })
        }
    }
    picked?.let { (ch, id) -> rows?.find { it.channel == ch && it.id == id } }?.let { r ->
        TodoSheet(
            r, rows.orEmpty(), { picked = null },
            setState = { s -> spaces.setState(r.channel, r, s) },
            setPrio = { p -> spaces.setPrio(r.channel, r, p) },
            edit = { picked = null; editing = r },
            remove = { picked = null; spaces.deleteTodo(r) },
            undoRoll = { spaces.undoRoll(r) },
        ) { seq -> picked = null; onJump(r.channel, seq) }
    }
    editing?.let { r -> TodoEdit(r, areas, fresh = rows?.none { it.channel == r.channel && it.id == r.id } != false, close = { editing = null }) { spaces.saveTodo(it.first, it.second) } }
    if (sheet) FilterSheet(filter, repos, areas, { filter = it }) { sheet = false }
}

@Composable
private fun AddButton(modifier: Modifier, onClick: () -> Unit) {
    val c = Aioa.colors
    Box(modifier.size(52.dp).clip(RoundedCornerShape(16.dp)).background(c.accent).clickable(onClick = onClick), contentAlignment = Alignment.Center) {
        Icon("plus", c.onAccent, 24.dp)
    }
}

/** 群里的看板顶上: 本群 / 全部。 */
@Composable
private fun ScopeSwitch(all: Boolean, set: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(horizontal = PAD.dp).padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        BarChip("message-circle", "本群", !all) { set(false) }
        BarChip("layers", "全部待办", all) { set(true) }
    }
}

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
private fun LazyListScope.section(s: TodoSection, closed: Set<String>, toggle: (String) -> Unit, showRepo: Boolean, open: (TodoRow) -> Unit, tick: (TodoRow) -> Unit) {
    stickyHeader(key = "s:${s.key}") { SectionHeader(s) }
    for (g in s.groups) {
        item(key = "g:${g.key}") {
            val c = Aioa.colors
            val shut = g.key in closed && g.title.isNotEmpty()
            Column(Modifier.fillMaxWidth().padding(bottom = 10.dp).clip(CARD).background(c.surface).animateContentSize()) {
                if (g.title.isNotEmpty()) Row(Modifier.fillMaxWidth().clickable { toggle(g.key) }.padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (g.repo != null) Icon("github", repoColor(g.repo), 15.dp)
                    else Icon("layers", c.textSecondary, 14.dp)
                    Text(g.title, Modifier.padding(start = 8.dp).weight(1f), color = c.text, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("${g.count}", color = c.textSecondary, fontSize = 12.sp)
                    Icon(if (shut) "chevron-right" else "chevron-down", c.textSecondary, 16.dp, Modifier.padding(start = 6.dp))
                }
                // 按截止看时分组是分区, 不再标分区; 其余维度标出分区以便区分生活与开发
                if (!shut) g.nodes.forEach { NodeRows(it, 0, closed, toggle, open, showRepo = showRepo && g.repo == null, showArea = !s.key.startsWith("due") && s.groups.size > 1, tick = tick) }
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
private fun AxisSwitch(axis: TodoAxis, set: (TodoAxis) -> Unit) {
    val c = Aioa.colors
    Row(Modifier.fillMaxWidth().padding(horizontal = PAD.dp, vertical = 8.dp).clip(RoundedCornerShape(10.dp)).background(c.surfaceAlt).padding(3.dp)) {
        for (a in TodoAxis.entries) {
            val on = a == axis
            val (label, icon) = a.label to a.icon
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
private fun FilterBar(f: TodoFilter, openSheet: () -> Unit, toggleStar: () -> Unit, toggleDone: () -> Unit) {
    val area = when {
        f.areas.isEmpty() -> "全部分区"
        f.areas.size == 1 -> f.areas.first()
        else -> "${f.areas.size} 个分区"
    }
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = PAD.dp).padding(bottom = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        BarChip("layers", area, f.areas.isNotEmpty(), openSheet)
        BarChip("star", "重点", f.onlyStar, toggleStar)
        BarChip(if (f.showDone) "eye" else "eye-off", if (f.showDone) "已完成 显示" else "已完成 隐藏", f.showDone, toggleDone)
        BarChip("sliders-horizontal", "筛选", f.repos.isNotEmpty() || f.onlyIssue || f.prios.size < 3, openSheet)
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
