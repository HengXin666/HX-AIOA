package com.hengxin.aioa.ui.todo

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Card
import com.hengxin.aioa.kit.CardHeader
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.TodoRow
import com.hengxin.aioa.ui.SpacesState
import com.hengxin.aioa.kit.Text as KitText

private const val FOCUS_LIMIT = 5
private const val ALL = "全部"

/**
 * 总览里 "点子待办" 工作台的待办组件: 与看板同一份数据 (本账号全部群) 和同一套行, 按分区切换, 截止近的在前;
 * "打开看板" 进全屏看板 (分区 / 截止 / 日期 / 仓库, 可新建)。
 */
@Composable
fun TodoCompact(spaces: SpacesState, limit: Int, onJump: (String, Long) -> Unit) {
    val c = Aioa.colors
    val rows = spaces.allTodos() ?: return KitText("加载中...", c.textSecondary, 13)
    var area by rememberSaveable { mutableStateOf(ALL) }
    var closed by rememberSaveable { mutableStateOf(setOf<String>()) }
    var board by rememberSaveable { mutableStateOf(false) }
    val ui = rememberTodoUi(spaces, rows, onJump)
    val areas = remember(rows) { rows.filter { !it.finished }.map { it.areaKey }.distinct() }
    val open = remember(rows, area) { forest(rows.filter { !it.finished && (area == ALL || it.areaKey == area) }, rows) }
    val toggle = { k: String -> closed = if (k in closed) closed - k else closed + k }
    CompositionLocalProvider(LocalNow provides rememberNow()) { Column(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(bottom = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            SmallChip("maximize-2", "打开看板", true) { board = true }
            SmallChip("plus", "新建", false) { ui.create(area.takeIf { it != ALL && it != TodoRow.AREA_NONE }) }
            (listOf(ALL) + areas).forEach { a -> SmallChip(null, a, a == area) { area = a } }
        }
        if (open.isEmpty()) KitText("没有待办, 点新建或去群里丢个想法", c.textSecondary, 13, Modifier.padding(vertical = 6.dp))
        open.take(limit).forEach { NodeRows(it, 0, closed, toggle, ui.open, showRepo = true, showArea = area == ALL, tick = ui.tick) }
        if (open.size > limit) KitText("还有 ${open.size - limit} 条, 打开看板看全部", c.textSecondary, 12, Modifier.padding(start = 12.dp, top = 6.dp).clickable { board = true })
        if (!board) UndoBar(spaces, Modifier.padding(top = 8.dp))
    } }
    ui.Sheets()
    if (board) TodoBoardScreen(spaces, { board = false }, onJump)
}

/** 总览 "日常" 页的重点待办: 星标, P1, 24 小时内到期与已逾期; 没有就不占位置。 */
@Composable
fun TodoFocus(spaces: SpacesState, onJump: (String, Long) -> Unit) {
    val rows = spaces.allTodos() ?: return
    val now = rememberNow()
    val focus = remember(rows, now) { focusNodes(rows, now) }
    var board by rememberSaveable { mutableStateOf(false) }
    val ui = rememberTodoUi(spaces, rows, onJump)
    if (focus.isNotEmpty()) CompositionLocalProvider(LocalNow provides now) { Card(onClick = { board = true }) {
        CardHeader("list-checks", "重点待办", "${focus.size} 条")
        focus.take(FOCUS_LIMIT).forEach { NodeRows(it, 0, emptySet(), {}, ui.open, showRepo = true, showArea = true, tick = ui.tick) }
        if (focus.size > FOCUS_LIMIT) KitText("还有 ${focus.size - FOCUS_LIMIT} 条, 点开看板", Aioa.colors.textSecondary, 12, Modifier.padding(start = 12.dp, top = 4.dp))
        if (!board) UndoBar(spaces, Modifier.padding(top = 8.dp))
    } }
    ui.Sheets()
    if (board) TodoBoardScreen(spaces, { board = false }, onJump)
}

/** 全屏看板: 本账号全部群的待办, 返回键关闭。 */
@Composable
fun TodoBoardScreen(spaces: SpacesState, close: () -> Unit, onJump: (String, Long) -> Unit) {
    val c = Aioa.colors
    Dialog(close, DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Column(Modifier.fillMaxSize().background(c.background).statusBarsPadding()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Row(Modifier.clip(RoundedCornerShape(50)).clickable(onClick = close).padding(8.dp)) { Icon("chevron-left", c.text, 22.dp) }
                androidx.compose.material3.Text("全部待办", color = c.text, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
            }
            TodoBoard(spaces, null, { ch, seq -> close(); onJump(ch, seq) }, Modifier.fillMaxSize())
        }
    }
}

/** 精简视图与重点卡片共用: 点一条出详情, 详情里可编辑, 删除, 跳原消息。 */
class TodoUi(
    private val spaces: SpacesState,
    private val rows: List<TodoRow>,
    private val onJump: (String, Long) -> Unit,
    pickedState: MutableState<TodoRow?>,
    editingState: MutableState<TodoRow?>,
) {
    private var picked by pickedState
    private var editing by editingState
    val open: (TodoRow) -> Unit = { picked = it }
    val tick: (TodoRow) -> Unit = { spaces.setTodo(it.channel, it, !it.finished) }

    fun create(area: String?) {
        editing = TodoRow(newTodoId(), "", null, TodoRow.STATE_OPEN, 2, null, 0, channel = homeGroup(rows), area = area)
    }

    @Composable
    fun Sheets() {
        picked?.let { p -> rows.find { it.channel == p.channel && it.id == p.id } }?.let { r ->
            TodoSheet(
                r, rows, { picked = null },
                setState = { s -> spaces.setState(r.channel, r, s) },
                setPrio = { p -> spaces.setPrio(r.channel, r, p) },
                edit = { picked = null; editing = r },
                remove = { picked = null; spaces.deleteTodo(r) },
                undoRoll = { spaces.undoRoll(r) },
            ) { seq -> picked = null; onJump(r.channel, seq) }
        }
        editing?.let { r -> TodoEdit(r, areasOf(rows), fresh = rows.none { it.channel == r.channel && it.id == r.id }, close = { editing = null }) { spaces.saveTodo(it.first, it.second) } }
    }
}

// 打开的详情与编辑放在组合里, 行变了 (同步回来) 用最新的那份找, 详情跟着刷新
@Composable
private fun rememberTodoUi(spaces: SpacesState, rows: List<TodoRow>, onJump: (String, Long) -> Unit): TodoUi {
    val picked = remember { mutableStateOf<TodoRow?>(null) }
    val editing = remember { mutableStateOf<TodoRow?>(null) }
    return TodoUi(spaces, rows, onJump, picked, editing)
}

@Composable
private fun SmallChip(icon: String?, label: String, on: Boolean, onClick: () -> Unit) {
    val c = Aioa.colors
    Row(Modifier.clip(RoundedCornerShape(50)).background(if (on) c.accent.copy(alpha = CHIP_ALPHA) else c.surfaceAlt).clickable(onClick = onClick).padding(horizontal = 10.dp, vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
        icon?.let { Icon(it, if (on) c.accent else c.textSecondary, 13.dp); Spacer(Modifier.width(4.dp)) }
        androidx.compose.material3.Text(label, color = if (on) c.accent else c.text, fontSize = 12.sp)
    }
}
