package com.hengxin.aioa.kit

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** 一条待办, 对应协议 TodoItem; prio 1 急, 2 普通, 3 以后; gh* 是服务端从 GitHub 同步的 issue 状态。 */
data class TodoRow(
    val id: String,
    val title: String,
    val note: String?,
    val state: String,
    val prio: Int,
    val src: Long?,
    val updated: Long,
    val created: Long = 0,
    val doneAt: Long? = null,
    val repo: String? = null,
    val issue: Int? = null,
    val parent: String? = null,
    val ghOpen: Boolean? = null,
    val ghComments: Int = 0,
    val ghParent: Int? = null,
) {
    val finished: Boolean get() = state == STATE_DONE || state == STATE_DROPPED

    companion object {
        const val STATE_DONE = "done"
        const val STATE_DROPPED = "dropped"
        const val STATE_OPEN = "open"
        const val STATE_DOING = "doing"
        const val STATE_HOLD = "hold"
    }
}

private const val DEFAULT_TODO_LIMIT = 20
private const val PRIO_URGENT = 1
private const val PRIO_LATER = 3

/** 待办组件: 未完成的按优先级排, 勾选即完成; 已完成的折叠在底部, 点开可以撤销。 */
@Composable
fun TodoView(item: SpaceItem, source: SpaceSource, handler: SpaceHandler) {
    val c = Aioa.colors
    val subject = item.binds.firstOrNull()?.subject ?: return Text("待办组件需要 bind 指向群", c.danger, 12)
    val rows = source.todos(subject)
    if (rows == null) return StateBody(CardState.Loading) {}
    val open = rows.filter { !it.finished }.sortedWith(compareBy<TodoRow> { it.prio }.thenByDescending { it.updated })
    val done = rows.filter { it.finished }.sortedByDescending { it.updated }
    if (open.isEmpty()) StateBody(CardState.Empty, "没有待办, 去群里丢个想法吧") {}
    open.take(item.num("limit")?.toInt() ?: DEFAULT_TODO_LIMIT).forEach { TodoLine(subject, it, handler) }
    if (done.isEmpty()) return
    var shown by rememberSaveable(item.id) { mutableStateOf(false) }
    Row(Modifier.clickable { shown = !shown }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(if (shown) "chevron-up" else "chevron-down", c.textSecondary, 14.dp)
        Spacer(Modifier.width(4.dp))
        Text("已完成 ${done.size} 条", c.textSecondary, 12)
    }
    if (shown) done.take(DEFAULT_TODO_LIMIT).forEach { TodoLine(subject, it, handler) }
}

@Composable
private fun TodoLine(subject: String, row: TodoRow, handler: SpaceHandler) {
    val c = Aioa.colors
    Row(Modifier.fillMaxWidth().padding(vertical = 3.dp), verticalAlignment = Alignment.Top) {
        Row(Modifier.clickable { handler.todo(subject, row, !row.finished) }.padding(top = 1.dp, end = 8.dp)) {
            Icon(if (row.finished) "square-check" else "square", if (row.finished) c.success else c.textSecondary, 18.dp)
        }
        Column(Modifier.weight(1f).clickable(enabled = row.src != null) { handler.openTodo(subject, row) }, verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                when {
                    row.finished -> Unit
                    row.prio == PRIO_URGENT -> { Dot(c.danger); Spacer(Modifier.width(6.dp)) }
                    row.state == TodoRow.STATE_DOING -> { Dot(c.accent); Spacer(Modifier.width(6.dp)) }
                    row.state == TodoRow.STATE_HOLD -> { Dot(c.textSecondary); Spacer(Modifier.width(6.dp)) }
                }
                Text(row.title, if (row.finished || row.prio == PRIO_LATER) c.textSecondary else c.text, 14, Modifier.weight(1f, fill = false))
            }
            row.note?.let { Paragraph(it, c.textSecondary, 12, maxLines = 2) }
        }
    }
}
