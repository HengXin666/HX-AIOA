package com.hengxin.aioa.ui.todo

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.TodoRow
import com.hengxin.aioa.ui.SpacesState

private const val CHIP_MAX_W = 260

/**
 * 主人那条消息下面挂它生出来的待办 (待办的 src 指向这条消息): "📌 标题 · 截止", 点开是待办详情。
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
    Column(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 2.dp), horizontalAlignment = if (mine) Alignment.End else Alignment.Start, verticalArrangement = Arrangement.spacedBy(3.dp)) {
        mineRows.forEach { r ->
            Row(
                Modifier.widthIn(max = CHIP_MAX_W.dp).clip(RoundedCornerShape(50)).background(c.accent.copy(alpha = CHIP_ALPHA)).clickable { picked = r.id }.padding(horizontal = 10.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(if (r.finished) "square-check" else "list-checks", if (r.finished) c.success else c.accent, 13.dp)
                val due = r.due?.takeIf { !r.finished }?.let { " · ${countdown(it).first}" }.orEmpty()
                Text(r.title + due, Modifier.padding(start = 5.dp), color = c.text, fontSize = 12.sp, textDecoration = if (r.finished) TextDecoration.LineThrough else null)
            }
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
