package com.hengxin.aioa.ui.todo

import com.hengxin.aioa.kit.TodoRow

// 待办父子树 (#152): 建树, 子项进度, 被筛掉父项的孤儿; 看板各列与列表各分组共用

/**
 * 树的一个节点。kids 是同一视图里显示的子项; done / total 是全部子孙里完成了几条 (不受筛选影响, 藏了已完成也是 2/5);
 * above 不为空时这是孤儿: 父项存在但不在这一列 / 这次筛选里, 行上标出上级。
 */
class TodoNode(
    val row: TodoRow,
    val kids: List<TodoNode>,
    val done: Int = kids.sumOf { (if (it.row.finished) 1 else 0) + it.done },
    val total: Int = kids.sumOf { 1 + it.total },
    val above: TodoRow? = null,
) {
    /** 这个节点与显示出来的子孙一共几行。 */
    val size: Int get() = 1 + kids.sumOf { it.size }
}

// 未完成在前, 星标在前, 截止近的在前, 再按优先级和新旧
internal val TODO_ORDER = compareBy<TodoRow> { it.finished }.thenBy { !it.star }.thenBy { it.due ?: Long.MAX_VALUE }.thenBy { it.prio }.thenByDescending { it.created }

// 看全部群时不同群的待办 id 可能相同, 一律带群区分
internal fun TodoRow.uid() = "$channel:$id"

/** 全部待办的父子索引: 父项 parent 字段优先 (同群), 其次 GitHub 的父 issue。 */
class TodoIndex(rows: List<TodoRow>) {
    private val byId = rows.associateBy { it.uid() }
    private val byIssue = rows.filter { it.repo != null && it.issue != null }.associateBy { "${it.repo}#${it.issue}" }
    private val kids = HashMap<String, MutableList<TodoRow>>()
    private val memo = HashMap<String, Pair<Int, Int>>()

    init {
        for (r in byId.values) parentOf(r)?.let { kids.getOrPut(it.uid()) { ArrayList() }.add(r) }
    }

    fun parentOf(r: TodoRow): TodoRow? {
        val p = r.parent?.let { byId["${r.channel}:$it"] } ?: if (r.ghParent != null && r.repo != null) byIssue["${r.repo}#${r.ghParent}"] else null
        return p?.takeIf { it.uid() != r.uid() }
    }

    /** 全部子孙的 (完成数, 总数); 成环的只算一遍。 */
    fun progress(r: TodoRow): Pair<Int, Int> = memo[r.uid()] ?: walk(r, HashSet()).also { memo[r.uid()] = it }

    private fun walk(r: TodoRow, seen: HashSet<String>): Pair<Int, Int> {
        seen.add(r.uid())
        var done = 0
        var total = 0
        for (k in kids[r.uid()].orEmpty()) {
            if (k.uid() in seen) continue
            val (d, t) = walk(k, seen)
            done += d + if (k.finished) 1 else 0
            total += t + 1
        }
        return done to total
    }
}

/**
 * 显示用的森林: rows 是要显示的 (筛选后 / 某一列), all 是全部待办 (算进度, 认孤儿)。
 * 父项不在 rows 里的升为根并记下上级; 成环的 (互为父子) 补成根, 一条都不丢。
 */
fun forest(rows: List<TodoRow>, all: List<TodoRow> = rows): List<TodoNode> {
    val index = TodoIndex((all + rows).distinctBy { it.uid() })
    val shown = rows.map { it.uid() }.toSet()
    val kids = HashMap<String, MutableList<TodoRow>>()
    val roots = ArrayList<Pair<TodoRow, TodoRow?>>()
    for (r in rows) {
        val p = index.parentOf(r)
        if (p != null && p.uid() in shown) kids.getOrPut(p.uid()) { ArrayList() }.add(r) else roots.add(r to p)
    }
    val seen = HashSet<String>()
    fun node(r: TodoRow, above: TodoRow?): TodoNode {
        seen.add(r.uid())
        val sub = kids[r.uid()].orEmpty().filter { it.uid() !in seen }.sortedWith(TODO_ORDER).map { node(it, null) }
        val (done, total) = index.progress(r)
        return TodoNode(r, sub, done, total, above)
    }
    val out = roots.sortedWith(compareBy(TODO_ORDER) { it.first }).mapTo(ArrayList()) { (r, p) -> node(r, p) }
    for (r in rows.sortedWith(TODO_ORDER)) if (r.uid() !in seen) out.add(node(r, null))
    return out
}

/** 看板的一列: 一种状态下的森林。 */
class TodoColumn(val state: String, val nodes: List<TodoNode>) {
    val count: Int get() = nodes.sumOf { it.size }
}

/** 一条待办落在哪一列: 已放弃算已完成, 不认识的状态算待进行。 */
fun columnOf(r: TodoRow): String = when {
    r.finished -> TodoRow.STATE_DONE
    r.state in STATES -> r.state
    else -> TodoRow.STATE_OPEN
}

/**
 * 按状态分列 (#152): 每列各自建树, 子项和父项状态不同时在自己那列当根, 标出上级; 进度按全部待办算。
 * 待进行 / 进行中 / 挂起三列总在, 已完成列只在筛选放出已完成时出现。
 */
fun stateColumns(shown: List<TodoRow>, all: List<TodoRow>): List<TodoColumn> {
    val by = shown.groupBy(::columnOf)
    return STATES.filter { it != TodoRow.STATE_DONE || by[it] != null }.map { s -> TodoColumn(s, forest(by[s].orEmpty(), all)) }
}

/** 总览的重点待办 (见 [focusRows]) 平铺成节点: 不带子项, 但带全部子孙的进度和上级标题, 与看板同一种行 (#152)。 */
fun focusNodes(rows: List<TodoRow>, now: Long = System.currentTimeMillis()): List<TodoNode> {
    val index = TodoIndex(rows)
    return focusRows(rows, now).map { r -> index.progress(r).let { (d, t) -> TodoNode(r, emptyList(), d, t, index.parentOf(r)) } }
}
