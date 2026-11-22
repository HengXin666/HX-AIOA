package com.hengxin.aioa.kit

// 工作台 schema 的客户端镜像, 对应 protocol/src/v1/space.ts 与 space-layout.ts; Web 与安卓渲染同一份布局

/** 组件类型, 与协议 ITEM_TYPES 一一对应。 */
object ItemType {
    const val VALUE = "value"
    const val SPARKLINE = "sparkline"
    const val LINE = "line"
    const val RING = "ring"
    const val STATUS_GRID = "status_grid"
    const val LIST = "list"
    const val TASK_CARD = "task_card"
    const val CHAT = "chat"
    const val APPROVAL = "approval"
    const val BUTTON = "button"
    const val REPORT = "report"
}

/** 标准指标字段的默认单位, 与协议 METRIC_FIELDS 一致; 采集器换了也不用改组件。 */
private const val PERCENT = "%"
val METRIC_UNITS: Map<String, String> = mapOf(
    "cpu" to PERCENT, "mem" to PERCENT, "disk" to PERCENT, "gpu" to PERCENT, "temp" to "°C", "net" to "MB/s",
)

/** 组件分类, 与协议 CATEGORY_OF 一致。 */
enum class ItemCategory { Metric, Status, List, Interaction, Action, Reading }

val CATEGORY_OF: Map<String, ItemCategory> = mapOf(
    ItemType.VALUE to ItemCategory.Metric,
    ItemType.SPARKLINE to ItemCategory.Metric,
    ItemType.LINE to ItemCategory.Metric,
    ItemType.RING to ItemCategory.Metric,
    ItemType.STATUS_GRID to ItemCategory.Status,
    ItemType.LIST to ItemCategory.List,
    ItemType.TASK_CARD to ItemCategory.List,
    ItemType.CHAT to ItemCategory.Interaction,
    ItemType.APPROVAL to ItemCategory.Interaction,
    ItemType.BUTTON to ItemCategory.Action,
    ItemType.REPORT to ItemCategory.Reading,
)

/** 面板宽度: 按 4 列网格占的列数, 窄屏时由网格收拢。 */
enum class PanelSize(val key: String, val span: Int, val label: String) {
    S("s", 1, "小"),
    M("m", 2, "中"),
    L("l", 3, "大"),
    Full("full", 4, "整行");

    /** 放大或缩小一档, 到头不变。 */
    fun step(delta: Int): PanelSize = entries[(ordinal + delta).coerceIn(0, entries.lastIndex)]

    companion object {
        fun of(key: String?): PanelSize? = entries.firstOrNull { it.key == key }
    }
}

/** 数据绑定: 来源无关, 只按 subject + 标准字段取值; source 只是声明期望的采集器。 */
data class SpaceBind(val subject: String, val field: String, val source: String? = null, val range: String? = null)

data class SpaceAction(val agent: String, val command: String, val danger: Boolean = false)

data class SpaceItem(
    val id: String,
    val type: String,
    val title: String? = null,
    val icon: String? = null,
    val question: String? = null,
    val binds: List<SpaceBind> = emptyList(),
    val props: Map<String, Any?> = emptyMap(),
    val action: SpaceAction? = null,
) {
    fun num(key: String): Float? = (props[key] as? Number)?.toFloat()
    fun str(key: String): String? = props[key] as? String
    val category: ItemCategory? get() = CATEGORY_OF[type]
}

/** everySec 为空表示推送模式。 */
data class SpacePanel(
    val id: String,
    val title: String,
    val icon: String? = null,
    val size: PanelSize? = null,
    val everySec: Int? = null,
    val items: List<SpaceItem> = emptyList(),
)

/** 用户自己的显示状态, 与布局分开存。 */
data class SpaceLayout(
    val hidden: Boolean = false,
    val hiddenPanels: List<String> = emptyList(),
    val order: List<String> = emptyList(),
    val sizes: Map<String, PanelSize> = emptyMap(),
)

data class Space(
    val id: String,
    val title: String,
    val icon: String? = null,
    val origin: String? = null,
    val panels: List<SpacePanel> = emptyList(),
    val layout: SpaceLayout = SpaceLayout(),
) {
    fun sizeOf(panel: SpacePanel): PanelSize = layout.sizes[panel.id] ?: panel.size ?: PanelSize.M

    /** 用户排序优先, 未排过的接在后面; 隐藏的面板不返回。 */
    fun orderedPanels(): List<SpacePanel> {
        val order = layout.order
        val rank = { p: SpacePanel -> order.indexOf(p.id).let { if (it < 0) order.size + panels.indexOf(p) else it } }
        return panels.filter { it.id !in layout.hiddenPanels }.sortedBy(rank)
    }

    /** 指标类组件绑定的主体, 页面可见时 watch 它们。 */
    fun metricSubjects(): Set<String> = panels.flatMap { p ->
        p.items.filter { it.category == ItemCategory.Metric || it.category == ItemCategory.Status }.flatMap { it.binds }.map { it.subject }
    }.toSet()
}

/** 用户在编辑模式里对布局的改动, 由调用方保存到服务端 (PUT /spaces/{id}/state)。 */
sealed interface LayoutChange {
    data class Order(val ids: List<String>) : LayoutChange
    data class Size(val panelId: String, val size: PanelSize) : LayoutChange
}

fun SpaceLayout.apply(change: LayoutChange): SpaceLayout = when (change) {
    is LayoutChange.Order -> copy(order = change.ids)
    is LayoutChange.Size -> copy(sizes = sizes + (change.panelId to change.size))
}
