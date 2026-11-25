package com.hengxin.aioa.ui.todo

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.ui.SpacesState

/**
 * 总览工作台里的待办组件: 与群里的待办看板同一套行 (父子树可折叠, P 级, 状态, issue 号与评论, 时间),
 * 不分组, 每条标仓库; 未完成的最多 limit 棵, 已完成的折叠在底部。点一条出同一个详情面板, 详情里可跳到原消息。
 */
@Composable
fun TodoCompact(spaces: SpacesState, channel: String, limit: Int, onJump: (Long) -> Unit) {
    val c = Aioa.colors
    val rows = spaces.todos(channel) ?: return Text("加载中...", c.textSecondary, 13)
    var closed by rememberSaveable(channel) { mutableStateOf(setOf<String>()) }
    var showDone by rememberSaveable(channel) { mutableStateOf(false) }
    var picked by remember { mutableStateOf<String?>(null) }
    val open = remember(rows) { forest(rows.filter { !it.finished }) }
    val done = remember(rows) { rows.filter { it.finished }.sortedByDescending { it.doneAt ?: it.updated } }
    val toggle = { k: String -> closed = if (k in closed) closed - k else closed + k }
    val tick = { r: com.hengxin.aioa.kit.TodoRow -> spaces.setTodo(channel, r, !r.finished) }
    Column(Modifier.fillMaxWidth()) {
        if (open.isEmpty()) Text("没有待办, 去群里丢个想法吧", c.textSecondary, 13, Modifier.padding(vertical = 6.dp))
        open.take(limit).forEach { NodeRows(it, 0, closed, toggle, { r -> picked = r.id }, showRepo = true, tick = tick) }
        if (open.size > limit) Text("还有 ${open.size - limit} 条, 去群里的看板看全部", c.textSecondary, 12, Modifier.padding(start = 12.dp, top = 6.dp))
        if (done.isNotEmpty()) {
            Row(Modifier.clickable { showDone = !showDone }.padding(start = 12.dp, top = 8.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(if (showDone) "chevron-up" else "chevron-down", c.textSecondary, 14.dp)
                Spacer(Modifier.width(4.dp))
                Text("已完成 ${done.size} 条", c.textSecondary, 12)
            }
            if (showDone) done.take(limit).forEach { NodeRows(TodoNode(it, emptyList()), 0, closed, toggle, { r -> picked = r.id }, showRepo = true, tick = tick) }
        }
    }
    picked?.let { id -> rows.find { it.id == id } }?.let { r ->
        TodoSheet(r, rows, { picked = null }, { s -> spaces.setState(channel, r, s) }, { p -> spaces.setPrio(channel, r, p) }) { seq -> picked = null; onJump(seq) }
    }
}
