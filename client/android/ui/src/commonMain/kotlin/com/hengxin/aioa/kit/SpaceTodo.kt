package com.hengxin.aioa.kit

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
    // 所在的群 (pdata 行 id 的前缀); 看全部待办时写回要用
    val channel: String = "",
    // 分区, 截止 (毫秒), 提前几分钟提醒, 闹钟响铃, 星标, 周期 (单位 day/week/month/year, 每 n 个), 已完成几期 (#105)
    val area: String? = null,
    val due: Long? = null,
    val remind: Int? = null,
    val alarm: Boolean = false,
    val star: Boolean = false,
    val everyUnit: String? = null,
    val everyN: Int = 1,
    val runs: Int = 0,
    // 周期待办推期前的截止, 撤销上次完成时退回去
    val prevDue: Long? = null,
) {
    val finished: Boolean get() = state == STATE_DONE || state == STATE_DROPPED

    /** 提醒时刻: 有截止且设了提醒, 还没完成。 */
    val fireAt: Long? get() = if (due != null && remind != null && !finished) due - remind * MINUTE_MS else null

    /** 分区: 没填时关联了仓库的算 "开发", 其余 "未分区"。 */
    val areaKey: String get() = area ?: if (repo != null) AREA_DEV else AREA_NONE

    companion object {
        const val STATE_DONE = "done"
        const val STATE_DROPPED = "dropped"
        const val STATE_OPEN = "open"
        const val STATE_DOING = "doing"
        const val STATE_HOLD = "hold"
        const val AREA_DEV = "开发"
        const val AREA_NONE = "未分区"
        const val MINUTE_MS = 60_000L
    }
}

private const val DEFAULT_TODO_LIMIT = 20

/** 待办组件 (App 没给看板时的简版): 与看板同一种行, 父子树可折叠, 勾选即完成; 已完成的折叠在底部, 点开可以撤销。 */
@Composable
fun TodoView(item: SpaceItem, source: SpaceSource, handler: SpaceHandler) {
    val c = Aioa.colors
    val subject = item.binds.firstOrNull()?.subject ?: return Text("待办组件需要 bind 指向群", c.danger, 12)
    source.todoView?.let { return it(subject, item.num("limit")?.toInt() ?: DEFAULT_TODO_LIMIT) }
    val rows = source.todos(subject)
    if (rows == null) return StateBody(CardState.Loading) {}
    val limit = item.num("limit")?.toInt() ?: DEFAULT_TODO_LIMIT
    val open = rows.filter { !it.finished }
    val done = rows.filter { it.finished }.sortedByDescending { it.updated }
    var closed by rememberSaveable(item.id) { mutableStateOf(setOf<String>()) }
    val line = TodoLines(subject, source.now, handler, closed) { k -> closed = if (k in closed) closed - k else closed + k }
    if (open.isEmpty()) StateBody(CardState.Empty, "没有待办, 去群里丢个想法吧") {}
    Column(Modifier.fillMaxWidth()) { todoForest(open).take(limit).forEach { line.Draw(it, emptyList()) } }
    if (done.isEmpty()) return
    var shown by rememberSaveable(item.id) { mutableStateOf(false) }
    Row(Modifier.clickable { shown = !shown }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(if (shown) "chevron-up" else "chevron-down", c.textSecondary, 14.dp)
        Spacer(Modifier.width(4.dp))
        Text("已完成 ${done.size} 条", c.textSecondary, 12)
    }
    if (shown) Column(Modifier.fillMaxWidth()) { done.take(limit).forEach { line.Draw(TodoTree(it, emptyList()), emptyList()) } }
}

/** 待办父子树的一个节点; done / total 数的是全部后代。 */
class TodoTree(val row: TodoRow, val kids: List<TodoTree>) {
    val total: Int get() = kids.sumOf { 1 + it.total }
    val done: Int get() = kids.sumOf { (if (it.row.finished) 1 else 0) + it.done }
}

/** 按 parent 搭树: 父项不在列表里的算根; 急的, 新的在前。 */
fun todoForest(rows: List<TodoRow>): List<TodoTree> {
    val ids = rows.map { it.id }.toSet()
    val byParent = rows.groupBy { it.parent?.takeIf { p -> p in ids } }
    val order = compareBy<TodoRow> { it.prio }.thenByDescending { it.updated }
    fun build(r: TodoRow, seen: Set<String>): TodoTree =
        TodoTree(r, byParent[r.id].orEmpty().filter { it.id !in seen }.sortedWith(order).map { build(it, seen + it.id) })
    return byParent[null].orEmpty().sortedWith(order).map { build(it, setOf(it.id)) }
}

private class TodoLines(val subject: String, val now: Long, val handler: SpaceHandler, val closed: Set<String>, val toggle: (String) -> Unit) {
    @Composable
    fun Draw(n: TodoTree, lasts: TreePath) {
        val r = n.row
        val shut = r.id in closed
        val fold = if (n.kids.isNotEmpty()) TodoFold(n.done, n.total, shut) { toggle(r.id) } else null
        TodoLine(r, now, { handler.openTodo(subject, r) }, { handler.todo(subject, r, !r.finished) }, lasts = lasts, fold = fold, showRepo = true)
        if (fold != null && !shut) n.kids.forEachIndexed { i, k -> Draw(k, lasts + (i == n.kids.lastIndex)) }
    }
}
