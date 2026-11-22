package com.hengxin.aioa.kit

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private const val SWEEP = 360f
private const val START_ANGLE = -90f
private const val PERCENT_MAX = 100f
private const val DEFAULT_LIMIT = 3
private const val LIST_LIMIT = 5
private const val CHAT_LINES = 4
private const val KEY_LIMIT = "limit"
private const val KEY_WARN = "warn"
private const val KEY_CRIT = "crit"
private val RING_SIZE = 76.dp
private val BUBBLE_SHAPE = RoundedCornerShape(12.dp)

/** 一个组件: 标题 + 它回答的问题 + 按类型渲染的内容; 类型集合与 Web 的 registry 一致。 */
@Composable
fun SpaceItemView(space: Space, panel: SpacePanel, item: SpaceItem, source: SpaceSource, handler: SpaceHandler) {
    val c = Aioa.colors
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (item.title != null && item.type != ItemType.BUTTON) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                item.icon?.let { Icon(it, c.textSecondary, 14.dp); Spacer(Modifier.width(4.dp)) }
                Text(item.title, c.textSecondary, 12)
            }
        }
        item.question?.let { Text(it, c.textSecondary.copy(alpha = 0.8f), 11) }
        when (item.type) {
            ItemType.VALUE -> Metric(panel, item, source) { b -> ValueView(item, b, source, false) }
            ItemType.SPARKLINE -> Metric(panel, item, source) { b -> ValueView(item, b, source, true) }
            ItemType.LINE -> Metric(panel, item, source) { b -> LineView(item, b, source) }
            ItemType.RING -> Metric(panel, item, source) { b -> RingView(item, b, source) }
            ItemType.STATUS_GRID -> Metric(panel, item, source) { StatusGrid(item, source) }
            ItemType.LIST -> ListView(item, source)
            ItemType.TASK_CARD -> Tasks(item, source, handler, waitingOnly = false)
            ItemType.APPROVAL -> Tasks(item, source, handler, waitingOnly = true)
            ItemType.CHAT -> ChatView(item, source, handler)
            ItemType.REPORT -> ReportItem(item, source)
            ItemType.BUTTON -> ButtonItem(space, item, handler)
            else -> Text("未知组件 ${item.type}", c.danger, 12)
        }
    }
}

@Composable
private fun Metric(panel: SpacePanel, item: SpaceItem, source: SpaceSource, content: @Composable (SpaceBind) -> Unit) {
    val bind = item.binds.firstOrNull() ?: return Text("缺少 bind", Aioa.colors.danger, 12)
    StateBody(source.metricState(panel, item)) { content(bind) }
}

private fun levelColor(item: SpaceItem, v: Float, c: AioaColors): Color {
    val crit = item.num(KEY_CRIT)
    val warn = item.num(KEY_WARN)
    return when {
        crit != null && v >= crit -> c.danger
        warn != null && v >= warn -> c.warning
        else -> c.text
    }
}

private fun unitOf(item: SpaceItem, b: SpaceBind, source: SpaceSource) = item.str("unit") ?: source.unit(b)

@Composable
private fun ValueView(item: SpaceItem, b: SpaceBind, source: SpaceSource, trend: Boolean) {
    val c = Aioa.colors
    val pts = source.series(b)
    val v = pts.lastOrNull()?.value ?: 0f
    Row(verticalAlignment = Alignment.Bottom) {
        Text(fmt(v), levelColor(item, v, c), 28, weight = FontWeight.SemiBold)
        Spacer(Modifier.width(3.dp))
        Text(unitOf(item, b, source), c.textSecondary, 13, Modifier.padding(bottom = 4.dp))
        Spacer(Modifier.weight(1f))
        if (trend && pts.size > 1) Sparkline(pts.map { it.value }, Modifier.widthIn(max = 96.dp).fillMaxWidth().height(28.dp))
    }
    if (!trend && pts.size > 1) {
        val d = pts.last().value - pts.first().value
        Text("${item.str("label") ?: b.subject} · ${b.range ?: "区间"}内 ${if (d >= 0) "+" else ""}${fmt(d)}", c.textSecondary, 11)
    }
}

@Composable
private fun LineView(item: SpaceItem, b: SpaceBind, source: SpaceSource) {
    val pts = source.series(b)
    if (pts.size < 2) return ValueView(item, b, source, false)
    LineChart(pts.map { Point(source.clock(it.ts), it.value) }, unitOf(item, b, source), height = 140.dp, threshold = item.num(KEY_CRIT) ?: item.num(KEY_WARN))
}

@Composable
private fun RingView(item: SpaceItem, b: SpaceBind, source: SpaceSource) {
    val c = Aioa.colors
    val v = source.series(b).lastOrNull()?.value ?: 0f
    val ratio = (v / (item.num("max") ?: PERCENT_MAX)).coerceIn(0f, 1f)
    val color = levelColor(item, v, c).let { if (it == c.text) c.accent else it }
    Box(Modifier.size(RING_SIZE), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(RING_SIZE)) {
            val w = 7.dp.toPx()
            val inset = Offset(w / 2, w / 2)
            val arc = Size(size.width - w, size.height - w)
            drawArc(c.surfaceAlt, 0f, SWEEP, false, inset, arc, style = Stroke(w))
            drawArc(color, START_ANGLE, SWEEP * ratio, false, inset, arc, style = Stroke(w, cap = StrokeCap.Round))
        }
        Row(verticalAlignment = Alignment.Bottom) {
            Text(fmt(v), c.text, 17, weight = FontWeight.SemiBold)
            Text(unitOf(item, b, source), c.textSecondary, 10, Modifier.padding(bottom = 2.dp))
        }
    }
}

/** 无阈值时按在线语义: 大于 0 在线, 0 离线; 有阈值时显示数值并按级别着色。 */
@Composable
private fun StatusGrid(item: SpaceItem, source: SpaceSource) {
    val c = Aioa.colors
    val labels = (item.props["labels"] as? List<*>)?.map { it?.toString() }.orEmpty()
    val thresholds = item.num(KEY_WARN) != null || item.num(KEY_CRIT) != null
    item.binds.forEachIndexed { i, b ->
        val v = source.samples(b).lastOrNull()?.value
        val (color, text) = when {
            v == null -> c.textSecondary to "--"
            thresholds -> levelColor(item, v, c).let { if (it == c.text) c.success else it } to "${fmt(v)}${unitOf(item, b, source)}"
            v > 0f -> c.success to "在线"
            else -> c.danger to "离线"
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Dot(color)
            Spacer(Modifier.width(8.dp))
            Text(labels.getOrNull(i) ?: b.subject, c.text, 14, Modifier.weight(1f))
            Text(text, color, 13)
        }
    }
}

private fun SpaceItem.subjects(): List<String> = binds.map { it.subject }.ifEmpty { listOf(ANY_SUBJECT) }

private fun SpaceItem.limit(default: Int): Int = num(KEY_LIMIT)?.toInt() ?: default

@Composable
private fun ListView(item: SpaceItem, source: SpaceSource) {
    val rows = item.subjects().flatMap { source.events(it) }.distinctBy { it.id }.take(item.limit(LIST_LIMIT))
    val state = source.error?.let { CardState.Error(it) } ?: if (rows.isEmpty()) if (source.ready) CardState.Empty else CardState.Loading else CardState.Ready
    StateBody(state) { rows.forEach { FeedRow(it) } }
}

@Composable
private fun Tasks(item: SpaceItem, source: SpaceSource, handler: SpaceHandler, waitingOnly: Boolean) {
    val subjects = item.subjects()
    // task_card 按任务 id 选, approval 按 Agent 选
    val tasks = source.tasks().filter { t ->
        val key = if (waitingOnly) t.agent else t.id
        (ANY_SUBJECT in subjects || key in subjects) && (!waitingOnly || (t.phase == TaskPhase.Waiting && !t.expired))
    }.take(item.limit(DEFAULT_LIMIT))
    if (tasks.isEmpty()) {
        StateBody(if (source.ready) CardState.Empty else CardState.Loading, if (waitingOnly) "没有待我处理的确认" else "暂无任务") {}
        return
    }
    tasks.forEach { t -> TaskCard(t, onOption = { handler.option(t, it) }) }
}

@Composable
private fun ChatView(item: SpaceItem, source: SpaceSource, handler: SpaceHandler) {
    val c = Aioa.colors
    val agent = item.str("agent")
    val ids = item.subjects()
    val task = source.tasks().firstOrNull { (ANY_SUBJECT in ids || it.id in ids) && (agent == null || it.agent == agent) }
    if (task == null) {
        StateBody(if (source.ready) CardState.Empty else CardState.Loading, "还没有对话") {}
        return
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(task.title, c.text, 15, Modifier.weight(1f), FontWeight.Medium)
        Text(task.phase.label, c.textSecondary, 12)
    }
    source.chat(task.id).takeLast(item.limit(CHAT_LINES)).forEach { line -> Bubble(line) }
    var draft by remember { mutableStateOf("") }
    Row(verticalAlignment = Alignment.CenterVertically) {
        BasicTextField(
            draft,
            { draft = it },
            Modifier.weight(1f).clip(BUBBLE_SHAPE).background(c.surfaceAlt).padding(horizontal = 12.dp, vertical = 8.dp),
            textStyle = TextStyle(color = c.text, fontSize = 14.sp),
            cursorBrush = SolidColor(c.accent),
            singleLine = true,
        )
        Spacer(Modifier.width(8.dp))
        PillButton("发送", ButtonStyle.Primary, enabled = draft.isNotBlank()) {
            handler.ask(task.id, draft.trim())
            draft = ""
        }
    }
}

@Composable
private fun Bubble(line: ChatLine) {
    val c = Aioa.colors
    val mine = line.role == ChatRole.User
    val bg = when (line.role) {
        ChatRole.User -> c.accent
        ChatRole.Agent -> c.surfaceAlt
        ChatRole.System -> Color.Transparent
    }
    val fg = if (mine) c.onAccent else if (line.role == ChatRole.System) c.textSecondary else c.text
    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start) {
        Box(Modifier.widthIn(max = 280.dp).clip(BUBBLE_SHAPE).background(bg).padding(horizontal = 10.dp, vertical = 6.dp)) {
            Paragraph(line.text, fg, 13)
        }
    }
}

@Composable
private fun ReportItem(item: SpaceItem, source: SpaceSource) {
    val c = Aioa.colors
    val r = item.subjects().firstNotNullOfOrNull { source.report(it) }
    if (r == null) {
        StateBody(if (source.ready) CardState.Empty else CardState.Loading, "还没有报告") {}
        return
    }
    Text(r.title, c.text, 16, weight = FontWeight.SemiBold)
    r.meta?.let { Text(it, c.textSecondary, 11) }
    r.summary?.let { Paragraph(it, c.textSecondary, 13, maxLines = 6) }
}

@Composable
private fun ButtonItem(space: Space, item: SpaceItem, handler: SpaceHandler) {
    val a = item.action ?: return Text("按钮缺少 action", Aioa.colors.danger, 12)
    val label = item.str("label") ?: item.title ?: a.command
    PillButton(label, if (a.danger) ButtonStyle.Danger else ButtonStyle.Primary) { handler.press(space, item) }
}
