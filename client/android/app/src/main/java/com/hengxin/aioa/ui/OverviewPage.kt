package com.hengxin.aioa.ui

import com.hengxin.aioa.kit.AnimatedItems
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import com.hengxin.aioa.kit.Chip
import com.hengxin.aioa.proto.Envelope
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.Constants
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.CardState
import com.hengxin.aioa.kit.Dot
import com.hengxin.aioa.kit.FeedItem
import com.hengxin.aioa.kit.LayerSection
import com.hengxin.aioa.kit.StatCard
import com.hengxin.aioa.kit.TaskCard
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.Tone
import com.hengxin.aioa.link.LinkLog
import java.util.Calendar
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.ui.text.font.FontWeight
import com.hengxin.aioa.kit.Card
import com.hengxin.aioa.kit.CardHeader
import com.hengxin.aioa.proto.plainLine

private const val ALERT_SRC_PREFIX = "probe"
private const val ALERT_WINDOW_MS = 24 * 60 * 60 * 1000L
private const val ALERTS_SHOWN = 3
private const val TITLE_NEED_ME = "需要我"
private const val TITLE_HAPPENING = "正在发生"
private const val NEED_ME_SHOWN = 5
private const val LAYER_SHOWN = 3

/** 总览三层: 需要我 (等待确认的任务与重要告警), 正在发生 (动态与资源), 值得一看 (报告与摘要)。 */
@Composable
fun OverviewPage(chat: ChatModel, openGithub: () -> Unit, open: (Tab) -> Unit) {
    val feed = chat.feed
    val spaces = chat.spaces.spaces
    var board by rememberSaveable { mutableStateOf(BOARD_DAILY) }
    val picked = spaces.firstOrNull { it.id == board }
    WatchProbes(chat.metrics, picked?.metricSubjects().orEmpty())
    val state = layerState(chat.online, feed.loaded, feed.updatedAt)
    var detail by remember { mutableStateOf<Envelope?>(null) }
    detail?.let { ev -> EventSheet(ev, { detail = null }) { detail = null; open(Tab.CHAT) } }
    PageColumn("总览") {
        Status(chat.online, chat.metrics.probes.size, feed.v1)
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            BOARDS.forEach { (id, label) -> Chip(label, board == id) { board = id } }
            spaces.forEach { s -> Chip(s.title, board == s.id) { board = s.id } }
        }
        when {
            picked != null -> SpacesSection(chat, picked.id)
            board == BOARD_DEV -> DevBoard(chat, openGithub, open)
            board == BOARD_SERVERS -> ServerBoard(chat, open)
            feed.v1 -> V1Layers(chat, state, open) { id -> detail = findEvent(feed, id) }
            else -> LegacyLayers(chat, state, open)
        }
    }
}

private const val BOARD_DAILY = "#daily"
private const val BOARD_DEV = "#dev"
private const val BOARD_SERVERS = "#servers"
private val BOARDS = listOf(BOARD_DAILY to "日常", BOARD_DEV to "开发", BOARD_SERVERS to "服务器")

private fun findEvent(feed: FeedState, id: String): Envelope? = feed.layers.values.flatten().firstOrNull { it.ev.id == id }?.ev

@Composable
private fun V1Layers(chat: ChatModel, state: CardState, open: (Tab) -> Unit, show: (String) -> Unit) {
    val feed = chat.feed
    val answer = rememberAnswer(chat)
    AnimatedItems(feed.tasks.values.filter { it.state == Constants.TASK_WAITING }.sortedByDescending { it.updated }, { it.id }) { task ->
        TaskCard(task.toCard(feed.pending[task.id]), onOption = { answer(task, it) }) { open(Tab.AGENT) }
    }
    Layer(chat, TITLE_NEED_ME, "少而重要", Constants.PRIORITY_NEED_ME, state, "一切正常, 没有需要处理的事", NEED_ME_SHOWN, show)
    Layer(chat, TITLE_HAPPENING, "不必立即处理", Constants.PRIORITY_HAPPENING, state, "暂时风平浪静", LAYER_SHOWN, show)
    ResourceTiles(chat, open)
    Layer(chat, "值得一看", "日报, 周报与摘要", Constants.PRIORITY_WORTH_READING, state, "今天没有新内容", LAYER_SHOWN, show)
}

// 点开看过或点 x 划掉的不再占位置; 新来的照常出现
@Composable
private fun Layer(chat: ChatModel, title: String, hint: String, priority: String, state: CardState, empty: String, limit: Int, show: (String) -> Unit) {
    val list = items(chat.feed, priority).filter { !chat.seen.has(it.id) }
    LayerSection(
        title, hint, list, state, empty,
        limit = limit,
        onDismiss = { chat.seen.mark(listOf(it.id)) },
        onClear = { chat.seen.mark(list.map { it.id }) },
    ) {
        chat.seen.mark(listOf(it.id))
        show(it.id)
    }
}

fun layerState(online: Boolean, loaded: Boolean, updatedAt: Long): CardState = when {
    !loaded && !online -> CardState.Error("未连接服务端, 正在重连")
    !loaded -> CardState.Loading
    !online && updatedAt > 0 -> CardState.Stale(LinkLog.clock(updatedAt))
    else -> CardState.Ready
}

// 任务由任务卡与 Agent 页展示, 层里只放事件与报告
private fun items(feed: FeedState, priority: String): List<FeedItem> =
    feed.layers[priority].orEmpty().filter { it.ev.kind != Constants.KIND_TASK }.map { it.toFeed() }

// 旧服务端只有消息: 近 24 小时的探针告警算 "需要我", 其余照旧
@Composable
private fun LegacyLayers(chat: ChatModel, state: CardState, open: (Tab) -> Unit) {
    val now = System.currentTimeMillis()
    val alerts = chat.messages.filter { it.src.startsWith(ALERT_SRC_PREFIX) && now - it.ts < ALERT_WINDOW_MS }
        .takeLast(ALERTS_SHOWN).reversed()
        .map { FeedItem(it.seq.toString(), "alert-triangle", plainLine(it.text), null, it.src.removePrefix("$ALERT_SRC_PREFIX-"), ago(it.ts), Tone.Warning) }
    val shown = if (state is CardState.Loading) CardState.Ready else state
    LayerSection(TITLE_NEED_ME, "近 24 小时告警", alerts, shown, "一切正常, 没有需要处理的事") { open(Tab.CHAT) }
    PageSection(TITLE_HAPPENING)
    ResourceTiles(chat, open)
}

// 装过的探针都列出来 (离线的也在), 一张卡看完; 没装过就什么都不放, 添加入口在资源页
@Composable
private fun ResourceTiles(chat: ChatModel, open: (Tab) -> Unit) {
    val metrics = chat.metrics
    val carded = metrics.hosts.map { it.subject }.toSet()
    val legacy = metrics.probes.filter { it !in carded }
    if (metrics.hosts.isNotEmpty() || legacy.isNotEmpty()) {
        Card(onClick = { open(Tab.RESOURCES) }) {
            val online = metrics.hosts.count { it.online } + legacy.size
            CardHeader("server", "设备", "$online/${metrics.hosts.size + legacy.size} 在线")
            metrics.hosts.forEach { h -> DeviceRow(metrics, h) }
            legacy.forEach { s -> LegacyRow(metrics, s) }
        }
    }
    val today = chat.messages.count { it.ts >= startOfToday() }
    if (today > 0) {
        StatCard(
            "message-circle", "今日消息", today.toFloat(), "条",
            delta = chat.messages.lastOrNull()?.text?.let(::plainLine), source = "HX-AIOA",
        ) { open(Tab.CHAT) }
    }
}

@Composable
private fun LegacyRow(metrics: MetricsState, subject: String) {
    val c = Aioa.colors
    val cpu = metrics.series(subject, KEY_CPU).lastOrNull()?.second
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Dot(c.success)
        Spacer(Modifier.width(8.dp))
        Text(subject, c.text, 14, Modifier.weight(1f), FontWeight.Medium)
        Text(cpu?.let { "在线 · CPU ${one(it.toDouble())}%" } ?: "在线", c.textSecondary, 12)
    }
}

@Composable
private fun Status(online: Boolean, probes: Int, v1: Boolean) {
    val c = Aioa.colors
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Dot(if (online) c.success else c.danger)
        val proto = if (v1) "" else " · 旧协议"
        Text(if (online) "已连接 · $probes 个探针在线$proto" else "未连接", c.textSecondary, 13)
    }
}

private fun startOfToday(): Long = Calendar.getInstance().apply {
    set(Calendar.HOUR_OF_DAY, 0)
    set(Calendar.MINUTE, 0)
    set(Calendar.SECOND, 0)
    set(Calendar.MILLISECOND, 0)
}.timeInMillis
