package com.hengxin.aioa.ui.todo

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.TodoFold
import com.hengxin.aioa.kit.TodoLine
import com.hengxin.aioa.kit.TodoRow
import com.hengxin.aioa.kit.TreePath
import com.hengxin.aioa.ui.SpacesState

private const val CARD_MAX_W = 300
private val CARD = RoundedCornerShape(12.dp)

/**
 * 主人那条消息下面挂它生出来的待办 (待办的 src 指向这条消息): 与看板同一种行, 点开是待办详情。
 * 整理员的回复里不写 id (#122), 想看哪条直接点这里。
 */
@Composable
fun TodoChips(spaces: SpacesState, channel: String, seq: Long, mine: Boolean, onJump: (Long) -> Unit) {
    val rows = spaces.todos(channel) ?: return
    val mineRows = remember(rows, seq) { rows.filter { it.src == seq } }
    if (mineRows.isEmpty()) return
    var picked by remember { mutableStateOf<String?>(null) }
    var editing by remember { mutableStateOf<TodoRow?>(null) }
    val c = Aioa.colors
    val now = rememberNow()
    var closed by remember { mutableStateOf(setOf<String>()) }
    val shown = remember(rows, seq) { hits(forest(rows), seq, false) }
    // 与看板同一种行 (#121): 一行一条, 子项带层级连线, 父项带进度
    Box(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 2.dp), contentAlignment = if (mine) Alignment.CenterEnd else Alignment.CenterStart) {
        Column(Modifier.widthIn(max = CARD_MAX_W.dp).clip(CARD).background(c.surface).border(0.5.dp, c.border, CARD).padding(bottom = 2.dp)) {
            val fold = { id: String -> closed = if (id in closed) closed - id else closed + id }
            shown.forEach { n -> Lines(n, emptyList(), now, closed, fold, { picked = it.id }) { r -> spaces.setTodo(channel, r, !r.finished) } }
        }
    }
    picked?.let { id -> rows.find { it.id == id } }?.let { r ->
        TodoSheet(
            r, rows, { picked = null },
            setState = { s -> spaces.setState(channel, r, s) },
            setPrio = { p -> spaces.setPrio(channel, r, p) },
            edit = { picked = null; editing = r },
            remove = { picked = null; spaces.deleteTodo(r) },
            undoRoll = { spaces.undoRoll(r) },
        ) { s -> picked = null; onJump(s) }
    }
    editing?.let { r -> TodoEdit(r, areasOf(rows), fresh = false, close = { editing = null }) { spaces.saveTodo(it.first, it.second) } }
}

// 这条消息生出来的待办: 父项也来自这条消息时只画父项 (子项在它下面)
private fun hits(nodes: List<TodoNode>, seq: Long, under: Boolean): List<TodoNode> = nodes.flatMap { n ->
    val hit = n.row.src == seq
    (if (hit && !under) listOf(n) else emptyList()) + hits(n.kids, seq, hit || under)
}

@Composable
private fun Lines(n: TodoNode, lasts: TreePath, now: Long, closed: Set<String>, toggle: (String) -> Unit, open: (TodoRow) -> Unit, tick: (TodoRow) -> Unit) {
    val r = n.row
    val shut = r.id in closed
    val fold = if (n.kids.isNotEmpty()) TodoFold(n.done, n.total, shut) { toggle(r.id) } else null
    TodoLine(r, now, { open(r) }, { tick(r) }, lasts = lasts, fold = fold)
    if (!shut) n.kids.forEachIndexed { i, k -> Lines(k, lasts + (i == n.kids.lastIndex), now, closed, toggle, open, tick) }
}
