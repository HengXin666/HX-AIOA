package com.hengxin.aioa.kit

import androidx.compose.runtime.Composable

/** 一个指标点。 */
data class MetricSample(val ts: Long, val value: Float)

data class ChatLine(val role: ChatRole, val text: String)

enum class ChatRole { Agent, User, System }

data class ReportView(val title: String, val summary: String?, val meta: String?)

/** 组件取数的统一入口: App 与画廊各自实现, 组件只按 subject + 标准字段取值, 不认识采集器。 */
interface SpaceSource {
    /** 是否已拿到首批数据, 决定显示 "加载中" 还是 "暂无数据"。 */
    val ready: Boolean
    /** 连接或来源错误, 非空时所有数据组件显示错误态。 */
    val error: String?
    val now: Long
    fun samples(bind: SpaceBind): List<MetricSample>
    fun unit(bind: SpaceBind): String
    fun events(subject: String): List<FeedItem>
    fun report(subject: String): ReportView?
    fun tasks(): List<TaskCardData>
    fun chat(taskId: String): List<ChatLine>
    fun clock(ts: Long): String
    /** 群下的待办; null 表示还在加载。 */
    fun todos(subject: String): List<TodoRow>? = emptyList()
    /** 待办组件的渲染 (群, 最多几条); App 给看板同款 (父子树, 状态, issue), 没给时用 kit 里的简版。 */
    val todoView: (@Composable (subject: String, limit: Int) -> Unit)? get() = null
}

/** 组件上的用户操作; 危险按钮的二次确认由实现方负责。 */
interface SpaceHandler {
    fun press(space: Space, item: SpaceItem)
    fun option(task: TaskCardData, option: TaskOption)
    fun ask(taskId: String, text: String)
    fun layout(space: Space, change: LayoutChange)
    fun todo(subject: String, row: TodoRow, done: Boolean) {}
    fun openTodo(subject: String, row: TodoRow) {}
}

const val ANY_SUBJECT = "*"
const val STALE_FACTOR = 2
private const val MS_PER_SEC = 1000L
private val RANGE = Regex("^(\\d+)([smhd])$")
private val UNIT_MS = mapOf("s" to 1_000L, "m" to 60_000L, "h" to 3_600_000L, "d" to 86_400_000L)

fun rangeMs(range: String?): Long {
    val m = range?.let { RANGE.find(it) } ?: return 0L
    return m.groupValues[1].toLong() * (UNIT_MS[m.groupValues[2]] ?: 0L)
}

/** 按 bind.range 截取最近一段。 */
fun SpaceSource.series(bind: SpaceBind): List<MetricSample> {
    val all = samples(bind)
    val ms = rangeMs(bind.range)
    if (ms == 0L || all.isEmpty()) return all
    val from = all.last().ts - ms
    return all.filter { it.ts >= from }
}

/** 指标组件的状态: 错误 > 加载/空 > 过期 > 正常; 过期阈值为刷新周期的 2 倍。 */
fun SpaceSource.metricState(panel: SpacePanel, item: SpaceItem): CardState {
    error?.let { return CardState.Error(it) }
    val last = item.binds.mapNotNull { samples(it).lastOrNull()?.ts }.maxOrNull()
        ?: return if (ready) CardState.Empty else CardState.Loading
    val expect = panel.everySec ?: item.num("expectSec")?.toInt()
    val limit = expect?.let { it * MS_PER_SEC * STALE_FACTOR }
    return if (limit != null && limit > 0 && now - last > limit) CardState.Stale(clock(last)) else CardState.Ready
}
