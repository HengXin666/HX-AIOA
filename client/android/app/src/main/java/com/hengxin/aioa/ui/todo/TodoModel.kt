package com.hengxin.aioa.ui.todo

import android.content.Context
import androidx.compose.ui.graphics.Color
import com.hengxin.aioa.kit.TodoRow
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/** 两个维度一键互换: 按日期 (天 > 仓库) 或按仓库 (仓库 > 天), 里面都是父子树。 */
enum class TodoAxis { DATE, REPO }

const val NO_REPO = "未关联仓库"
private const val DAY_FMT = "yyyy-MM-dd"
private const val SHORT_FMT = "MM-dd"
private const val TIME_FMT = "HH:mm"
private const val DAY_MS = 86_400_000L

/** 界面显示的四态, dropped 是旧数据按已完成算。 */
val STATES = listOf(TodoRow.STATE_OPEN, TodoRow.STATE_DOING, TodoRow.STATE_HOLD, TodoRow.STATE_DONE)
fun stateLabel(s: String) = when (s) {
    TodoRow.STATE_DOING -> "进行中"
    TodoRow.STATE_HOLD -> "挂起"
    TodoRow.STATE_DONE -> "已完成"
    TodoRow.STATE_DROPPED -> "已放弃"
    else -> "待进行"
}

/** 树的一个节点; done / total 是子孙里完成了几条。 */
class TodoNode(val row: TodoRow, val kids: List<TodoNode>) {
    val total: Int get() = kids.sumOf { 1 + it.total }
    val done: Int get() = kids.sumOf { (if (it.row.finished) 1 else 0) + it.done }
}

/** repo 非空时分组头画仓库色点 (按日期维度), 否则画日历图标。 */
class TodoGroup(val key: String, val title: String, val nodes: List<TodoNode>, val repo: String? = null) {
    val count: Int get() = nodes.sumOf { 1 + it.total }
}

class TodoSection(val key: String, val title: String, val sub: String, val groups: List<TodoGroup>, val repo: String? = null)

/** 筛选: repos 为空表示全部; 默认藏已完成。 */
data class TodoFilter(val repos: Set<String> = emptySet(), val showDone: Boolean = false, val onlyIssue: Boolean = false, val prios: Set<Int> = setOf(1, 2, 3)) {
    fun keep(r: TodoRow) = (showDone || !r.finished) && (!onlyIssue || r.issue != null) &&
        r.prio in prios && (repos.isEmpty() || (r.repo ?: NO_REPO) in repos)

    companion object {
        private const val PREFS = "todo_board"

        fun load(context: Context, channel: String): Pair<TodoFilter, TodoAxis> {
            val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val f = TodoFilter(
                repos = p.getStringSet("$channel.repos", emptySet()).orEmpty(),
                showDone = p.getBoolean("$channel.done", false),
                onlyIssue = p.getBoolean("$channel.issue", false),
                prios = p.getStringSet("$channel.prio", null)?.mapNotNull { it.toIntOrNull() }?.toSet() ?: setOf(1, 2, 3),
            )
            return f to if (p.getString("$channel.axis", null) == TodoAxis.REPO.name) TodoAxis.REPO else TodoAxis.DATE
        }

        fun save(context: Context, channel: String, f: TodoFilter, axis: TodoAxis) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putStringSet("$channel.repos", f.repos).putBoolean("$channel.done", f.showDone).putBoolean("$channel.issue", f.onlyIssue)
                .putStringSet("$channel.prio", f.prios.map { it.toString() }.toSet()).putString("$channel.axis", axis.name).apply()
        }
    }
}

fun dayOf(ts: Long): String = SimpleDateFormat(DAY_FMT, Locale.ROOT).format(Date(ts))
fun shortDay(ts: Long): String = SimpleDateFormat(SHORT_FMT, Locale.ROOT).format(Date(ts))
fun clock(ts: Long): String = SimpleDateFormat(TIME_FMT, Locale.ROOT).format(Date(ts))

/** "今天 11-25" / "昨天 11-24" / "11-20 周四"。 */
fun dayTitle(day: String, now: Long = System.currentTimeMillis()): Pair<String, String> {
    val today = dayOf(now)
    val yesterday = dayOf(now - DAY_MS)
    val date = SimpleDateFormat(DAY_FMT, Locale.ROOT).parse(day) ?: return day to ""
    val cal = Calendar.getInstance().apply { time = date }
    val week = "周" + "日一二三四五六"[cal.get(Calendar.DAY_OF_WEEK) - 1]
    val short = day.substring(5)
    return when (day) {
        today -> "今天 $short" to week
        yesterday -> "昨天 $short" to week
        else -> short to week
    }
}

fun repoName(repo: String) = repo.substringAfter('/')

/** 仓库的固定颜色: 名字哈希到一组好分辨的色。 */
private val REPO_COLORS = listOf(0xFF2F6BFF, 0xFF12A150, 0xFFD97706, 0xFF8250DF, 0xFFDB2777, 0xFF0891B2, 0xFF65A30D)
fun repoColor(repo: String): Color = if (repo == NO_REPO) Color(0xFF9CA3AF) else Color(REPO_COLORS[Math.floorMod(repo.hashCode(), REPO_COLORS.size)])

/** 父待办: parent 字段优先, 其次 GitHub 的父 issue。 */
private fun parentOf(r: TodoRow, byId: Map<String, TodoRow>, byIssue: Map<String, TodoRow>): TodoRow? =
    r.parent?.let(byId::get) ?: if (r.ghParent != null && r.repo != null) byIssue["${r.repo}#${r.ghParent}"] else null

private val ORDER = compareBy<TodoRow> { it.finished }.thenBy { it.prio }.thenByDescending { it.created }

/** 筛选后的森林: 父不在结果里的子待办升为根。 */
fun forest(rows: List<TodoRow>): List<TodoNode> {
    val byId = rows.associateBy { it.id }
    val byIssue = rows.filter { it.repo != null && it.issue != null }.associateBy { "${it.repo}#${it.issue}" }
    val kids = HashMap<String, MutableList<TodoRow>>()
    val roots = ArrayList<TodoRow>()
    for (r in rows) {
        val p = parentOf(r, byId, byIssue)?.takeIf { it.id != r.id }
        if (p != null) kids.getOrPut(p.id) { ArrayList() }.add(r) else roots.add(r)
    }
    val seen = HashSet<String>()
    fun node(r: TodoRow): TodoNode {
        seen.add(r.id)
        return TodoNode(r, kids[r.id].orEmpty().filter { it.id !in seen }.sortedWith(ORDER).map(::node))
    }
    return roots.sortedWith(ORDER).map(::node)
}

private fun repoKey(r: TodoRow) = r.repo ?: NO_REPO
private val REPO_ORDER = compareBy<String> { it == NO_REPO }.thenBy { it.lowercase() }

/** 按维度切成分节; 根的日期和仓库决定位置, 子待办跟着父。 */
fun sections(rows: List<TodoRow>, axis: TodoAxis): List<TodoSection> {
    val roots = forest(rows)
    return when (axis) {
        TodoAxis.DATE -> roots.groupBy { dayOf(it.row.created) }.toSortedMap(reverseOrder()).map { (day, nodes) ->
            val (title, week) = dayTitle(day)
            val groups = nodes.groupBy { repoKey(it.row) }.toSortedMap(REPO_ORDER).map { (repo, ns) -> TodoGroup("$day|$repo", if (repo == NO_REPO) repo else repoName(repo), ns, repo) }
            TodoSection(day, title, "$week · ${groups.sumOf { it.count }} 条", groups)
        }
        TodoAxis.REPO -> roots.groupBy { repoKey(it.row) }.toSortedMap(REPO_ORDER).map { (repo, nodes) ->
            val groups = nodes.groupBy { dayOf(it.row.created) }.toSortedMap(reverseOrder()).map { (day, ns) -> TodoGroup("$repo|$day", dayTitle(day).first, ns) }
            TodoSection(repo, if (repo == NO_REPO) repo else repoName(repo), "${groups.sumOf { it.count }} 条 · ${groups.size} 天", groups, repo)
        }
    }
}
