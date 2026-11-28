package com.hengxin.aioa.ui.todo

import android.content.Context
import androidx.compose.ui.graphics.Color
import com.hengxin.aioa.kit.TodoRow
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/**
 * 看板的视图, 里面都是父子树: 看板 (按状态分列, #152), 其余是列表: 分区 (分区 > 仓库),
 * 截止 (逾期 / 今天 / 明天 / 7 天内 / 以后 / 无截止), 日期 (创建的天 > 仓库), 仓库 (仓库 > 天)。
 */
enum class TodoAxis(val label: String, val icon: String) {
    STATE("看板", "square-kanban"), AREA("分区", "layers"), DUE("截止", "alarm-clock"), DATE("日期", "calendar-days"), REPO("仓库", "folder"),
}

const val NO_REPO = "未关联仓库"
private const val DAY_FMT = "yyyy-MM-dd"
private const val SHORT_FMT = "MM-dd"
private const val TIME_FMT = "HH:mm"
internal const val DAY_MS = 86_400_000L
private const val WEEK_DAYS = 7
/** 新建时可选的分区; 用过的自定义分区也会出现在选项里。 */
val PRESET_AREAS = listOf("生活", "开发", "工作", "学习")

/** 界面显示的四态, dropped 是旧数据按已完成算。 */
val STATES = listOf(TodoRow.STATE_OPEN, TodoRow.STATE_DOING, TodoRow.STATE_HOLD, TodoRow.STATE_DONE)
fun stateLabel(s: String) = when (s) {
    TodoRow.STATE_DOING -> "进行中"
    TodoRow.STATE_HOLD -> "挂起"
    TodoRow.STATE_DONE -> "已完成"
    TodoRow.STATE_DROPPED -> "已放弃"
    else -> "待进行"
}

/** repo 非空时分组头画仓库色点 (按日期维度), 否则画日历图标。 */
class TodoGroup(val key: String, val title: String, val nodes: List<TodoNode>, val repo: String? = null) {
    val count: Int get() = nodes.sumOf { it.size }
}

class TodoSection(val key: String, val title: String, val sub: String, val groups: List<TodoGroup>, val repo: String? = null)

/** 筛选: areas / repos 为空表示全部; 默认藏已完成。 */
data class TodoFilter(
    val repos: Set<String> = emptySet(),
    val showDone: Boolean = false,
    val onlyIssue: Boolean = false,
    val prios: Set<Int> = setOf(1, 2, 3),
    val areas: Set<String> = emptySet(),
    val onlyStar: Boolean = false,
) {
    fun keep(r: TodoRow) = (showDone || !r.finished) && (!onlyIssue || r.issue != null) && (!onlyStar || r.star) &&
        r.prio in prios && (repos.isEmpty() || (r.repo ?: NO_REPO) in repos) && (areas.isEmpty() || r.areaKey in areas)

    companion object {
        private const val PREFS = "todo_board"
        private const val KEY_VIEW = "view"

        fun load(context: Context, channel: String): Pair<TodoFilter, TodoAxis> {
            val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val f = TodoFilter(
                repos = p.getStringSet("$channel.repos", emptySet()).orEmpty(),
                showDone = p.getBoolean("$channel.done", false),
                onlyIssue = p.getBoolean("$channel.issue", false),
                prios = p.getStringSet("$channel.prio", null)?.mapNotNull { it.toIntOrNull() }?.toSet() ?: setOf(1, 2, 3),
                areas = p.getStringSet("$channel.areas", emptySet()).orEmpty(),
                onlyStar = p.getBoolean("$channel.star", false),
            )
            // 键从 axis 换成 view (#152): 默认改成看板, 旧版存下的默认分区不再沿用
            return f to (TodoAxis.entries.firstOrNull { it.name == p.getString("$channel.$KEY_VIEW", null) } ?: TodoAxis.STATE)
        }

        fun save(context: Context, channel: String, f: TodoFilter, axis: TodoAxis) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putStringSet("$channel.repos", f.repos).putBoolean("$channel.done", f.showDone).putBoolean("$channel.issue", f.onlyIssue)
                .putStringSet("$channel.prio", f.prios.map { it.toString() }.toSet()).putString("$channel.$KEY_VIEW", axis.name)
                .putStringSet("$channel.areas", f.areas).putBoolean("$channel.star", f.onlyStar).apply()
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

/** 仓库的固定颜色, 与组件库待办行一致。 */
fun repoColor(repo: String): Color = com.hengxin.aioa.kit.repoTint(repo.takeIf { it != NO_REPO })

private fun repoKey(r: TodoRow) = r.repo ?: NO_REPO
private val REPO_ORDER = compareBy<String> { it == NO_REPO }.thenBy { it.lowercase() }

// 不关联仓库的一组: 按日期看时叫 "未关联仓库", 按分区看时不画组头 (生活事务本来就没有仓库)
private fun byRepo(key: String, nodes: List<TodoNode>, noRepo: String = NO_REPO) =
    nodes.groupBy { repoKey(it.row) }.toSortedMap(REPO_ORDER).map { (repo, ns) -> TodoGroup("$key|$repo", if (repo == NO_REPO) noRepo else repoName(repo), ns, repo) }

/** 分区顺序: 预设的在前 (生活, 开发, 工作, 学习), 自定义的按名字, 未分区最后。 */
private val AREA_ORDER = compareBy<String> { it == TodoRow.AREA_NONE }.thenBy { PRESET_AREAS.indexOf(it).let { i -> if (i < 0) PRESET_AREAS.size else i } }.thenBy { it }

/** 截止分桶: 0 逾期, 1 今天, 2 明天, 3 七天内, 4 以后, 5 无截止。 */
private val DUE_BUCKETS = listOf("已逾期", "今天", "明天", "7 天内", "以后", "无截止")
fun dueBucket(due: Long?, now: Long = System.currentTimeMillis()): Int {
    if (due == null) return DUE_BUCKETS.size - 1
    if (due < now) return 0
    val days = dayIndex(due) - dayIndex(now)
    return when {
        days == 0L -> 1
        days == 1L -> 2
        days < WEEK_DAYS -> 3
        else -> 4
    }
}
private fun dayIndex(ts: Long): Long = (ts + java.util.TimeZone.getDefault().getOffset(ts)) / DAY_MS

/** 按维度切成分节; 根的日期, 分区, 截止, 仓库决定位置, 子待办跟着父; all 为全部待办 (算进度, 认孤儿)。看板视图不走这里。 */
fun sections(rows: List<TodoRow>, axis: TodoAxis, all: List<TodoRow> = rows): List<TodoSection> {
    val roots = forest(rows, all)
    return when (axis) {
        TodoAxis.STATE -> stateColumns(rows, all).filter { it.count > 0 }.map { col ->
            TodoSection(col.state, stateLabel(col.state), "${col.count} 条", listOf(TodoGroup(col.state, "", col.nodes)))
        }
        TodoAxis.AREA -> roots.groupBy { it.row.areaKey }.toSortedMap(AREA_ORDER).map { (area, nodes) ->
            val groups = byRepo(area, nodes, "")
            TodoSection(area, area, "${groups.sumOf { it.count }} 条", groups)
        }
        TodoAxis.DUE -> roots.groupBy { dueBucket(it.row.due) }.toSortedMap().map { (b, nodes) ->
            val groups = nodes.groupBy { it.row.areaKey }.toSortedMap(AREA_ORDER).map { (area, ns) -> TodoGroup("due$b|$area", area, ns) }
            TodoSection("due$b", DUE_BUCKETS[b], "${groups.sumOf { it.count }} 条", groups)
        }
        TodoAxis.DATE -> roots.groupBy { dayOf(it.row.created) }.toSortedMap(reverseOrder()).map { (day, nodes) ->
            val (title, week) = dayTitle(day)
            val groups = byRepo(day, nodes)
            TodoSection(day, title, "$week · ${groups.sumOf { it.count }} 条", groups)
        }
        TodoAxis.REPO -> roots.groupBy { repoKey(it.row) }.toSortedMap(REPO_ORDER).map { (repo, nodes) ->
            val groups = nodes.groupBy { dayOf(it.row.created) }.toSortedMap(reverseOrder()).map { (day, ns) -> TodoGroup("$repo|$day", dayTitle(day).first, ns) }
            TodoSection(repo, if (repo == NO_REPO) repo else repoName(repo), "${groups.sumOf { it.count }} 条 · ${groups.size} 天", groups, repo)
        }
    }
}

/** 倒计时, 见组件库 todoCountdown; 第二项为 true 表示逾期或 24 小时内 (标红)。 */
fun countdown(due: Long, now: Long = System.currentTimeMillis()): Pair<String, Boolean> = com.hengxin.aioa.kit.todoCountdown(due, now)

/** 截止时间: 今年的省略年份。 */
fun dueText(due: Long): String {
    val sameYear = SimpleDateFormat("yyyy", Locale.ROOT).let { it.format(Date(due)) == it.format(Date()) }
    return SimpleDateFormat(if (sameYear) "MM-dd HH:mm" else "yyyy-MM-dd HH:mm", Locale.ROOT).format(Date(due))
}

val EVERY_UNITS = listOf("day" to "天", "week" to "周", "month" to "个月", "year" to "年")
fun everyText(unit: String?, n: Int): String? {
    val u = EVERY_UNITS.firstOrNull { it.first == unit }?.second ?: return null
    return if (n == 1) "每${u.removePrefix("个")}" else "每 $n $u"
}

/** 提前量: 0 到点, 15 分钟, 2 小时, 1 天。 */
fun remindText(min: Int): String = when {
    min == 0 -> "到点提醒"
    min % (24 * 60) == 0 -> "提前 ${min / (24 * 60)} 天"
    min % 60 == 0 -> "提前 ${min / 60} 小时"
    else -> "提前 $min 分钟"
}

/** 本地闹钟计划; 键与服务端提醒消息的去重键一致。 */
fun alarmPlan(r: TodoRow): com.hengxin.aioa.link.TodoAlarmPlan? {
    val at = r.fireAt ?: return null
    val due = r.due ?: return null
    val lead = if (r.remind == 0) "现在到点 (${dueText(due)})" else "还有 ${remindText(r.remind ?: 0).removePrefix("提前 ")} 截止 (${dueText(due)})"
    return com.hengxin.aioa.link.TodoAlarmPlan(com.hengxin.aioa.link.TodoAlarms.key(r.channel, r.id, at), at, r.channel, "⏰ ${r.title}", lead, r.alarm)
}

/** 总览的重点待办: 星标或 P1 的未完成, 加上 24 小时内到期和已逾期的; 逾期和快到期的排前面。 */
fun focusRows(rows: List<TodoRow>, now: Long = System.currentTimeMillis()): List<TodoRow> =
    rows.filter { !it.finished && (it.star || it.prio == 1 || (it.due?.let { d -> d - now < DAY_MS } == true)) }
        .sortedWith(compareBy<TodoRow> { it.due ?: Long.MAX_VALUE }.thenBy { !it.star }.thenBy { it.prio })

const val MINUTE_MS = 60_000L
// 没有任何待办时, 新建的放进待办插件自己的群
const val DEFAULT_TODO_GROUP = "plugin-todo"

/** 分区选项: 预设 + 已用过的, 未分区不算。 */
fun areasOf(rows: List<TodoRow>): List<String> = (PRESET_AREAS + rows.mapNotNull { it.area }).distinct()

/** 在 "全部" 里新建时放哪个群: 待办插件的群优先, 否则待办最多的群。 */
fun homeGroup(rows: List<TodoRow>): String =
    rows.firstOrNull { it.channel == DEFAULT_TODO_GROUP }?.channel ?: rows.groupingBy { it.channel }.eachCount().maxByOrNull { it.value }?.key ?: DEFAULT_TODO_GROUP

/** App 里新建的待办 id: m- 加时间 (36 进制), 与 Agent 的 t-<seq> 区分。 */
fun newTodoId(now: Long = System.currentTimeMillis()): String = "m-${now.toString(36)}"
