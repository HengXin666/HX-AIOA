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
import androidx.compose.runtime.setValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.delay
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
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.ui.text.font.FontWeight
import com.hengxin.aioa.kit.Card
import com.hengxin.aioa.kit.CardHeader
import com.hengxin.aioa.proto.plainLine
import com.hengxin.aioa.proto.toMsg
import com.hengxin.aioa.data.groupKey
import com.hengxin.aioa.ui.chat.mailItem

private const val ALERT_SRC_PREFIX = "probe"
private const val ALERT_WINDOW_MS = 24 * 60 * 60 * 1000L
private const val ALERTS_SHOWN = 3
private const val TITLE_NEED_ME = "需要我"
private const val TITLE_HAPPENING = "正在发生"
private const val NEED_ME_SHOWN = 5
private const val LAYER_SHOWN = 3
private const val CODE_TICK_MS = 30_000L

/** 总览三层: 需要我 (等待确认的任务与重要告警), 正在发生 (动态与资源), 值得一看 (报告与摘要)。 */
@Composable
fun OverviewPage(chat: ChatModel, openGithub: () -> Unit, open: (Tab) -> Unit) {
    val feed = chat.feed
    // 只取没隐藏的空间, 和顶部标签一致 (#139): 藏起来的空间不再当看板显示
    val spaces = chat.spaces.spaces.filter { !it.layout.hidden }
    val board = chat.spaces.board
    val picked = spaces.firstOrNull { it.id == board }
    WatchProbes(chat.metrics, picked?.metricSubjects().orEmpty())
    val state = layerState(chat.online, feed.loaded, feed.updatedAt)
    var detail by remember { mutableStateOf<Envelope?>(null) }
    val mails = com.hengxin.aioa.ui.chat.rememberMailState()
    detail?.let { ev ->
        // 邮件: 直接用邮件详情打开这一封, 不进群 (不动群里其它消息的已读); 其它: 预览, 可去所在的群定位到它
        val mail = remember(ev.id) { ev.mailItem(mails.api) }
        if (mail != null) com.hengxin.aioa.ui.chat.MailPeek(mail, mails) { detail = null }
        else EventSheet(ev, { detail = null }) { detail = null; chat.groups.openAt(ev.toMsg().groupKey(), ev.seq) }
    }
    // 待办空间整页是看板 (#152): 看板自己管滚动, 不放进可滚动的卡片列
    if (picked != null && isTodoSpace(picked)) return Column(Modifier.fillMaxSize()) {
        if (!LocalShellBar.current) BoardChips(chat, spaces, board, Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
        com.hengxin.aioa.ui.todo.TodoBoard(chat.spaces, null, { ch, seq -> chat.groups.openAt(ch, seq) }, Modifier.weight(1f))
    }
    PageColumn("总览") {
        if (!feed.v1) Status(chat.online, chat.metrics.probes.size, feed.v1)
        // 新外壳里看板在顶栏标题的空间切换里选 (#138), 这排 Chip 只留给旧外壳与平板
        if (!LocalShellBar.current) BoardChips(chat, spaces, board)
        when {
            picked != null -> SpacesSection(chat, picked.id)
            board == BOARD_DEV -> DevBoard(chat, openGithub, open)
            board == BOARD_SERVERS -> ServerBoard(chat, open)
            feed.v1 -> OverviewV2(chat, state, open, openGithub) { id -> detail = findEvent(feed, id) }
            else -> LegacyLayers(chat, state, open)
        }
    }
}

@Composable
private fun BoardChips(chat: ChatModel, spaces: List<com.hengxin.aioa.kit.Space>, board: String, modifier: Modifier = Modifier) {
    Row(modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        BOARDS.forEach { (id, label) -> Chip(label, board == id) { chat.spaces.board = id } }
        spaces.forEach { s -> Chip(s.title, board == s.id) { chat.spaces.board = s.id } }
    }
}

private fun findEvent(feed: FeedState, id: String): Envelope? = feed.layers.values.flatten().firstOrNull { it.ev.id == id }?.ev

// 点开看过或点 x 划掉的不再占位置; 新来的照常出现
@Composable
internal fun Layer(chat: ChatModel, title: String, hint: String, priority: String, state: CardState, empty: String, limit: Int, show: (String) -> Unit) {
    val context = LocalContext.current
    // 验证码剩余时间 (#146): 有验证码时每半分钟刷新一次
    val now by produceState(System.currentTimeMillis(), chat.feed.layers[priority]) {
        if (chat.feed.layers[priority].orEmpty().none { it.ev.mail != null }) return@produceState
        while (true) {
            delay(CODE_TICK_MS)
            value = System.currentTimeMillis()
        }
    }
    val list = items(chat.feed, priority, now).filter { !chat.seen.has(it.id) }
    // 总览里看过的同一条, 群里也算已读
    val seqs = chat.feed.layers[priority].orEmpty().associate { it.ev.id to it.ev.seq }
    val mark = { ids: List<String> ->
        chat.seen.mark(ids)
        chat.groups.markSeen(ids.mapNotNull { seqs[it] }.filter { it > 0 })
    }
    LayerSection(
        title, hint, list, state, empty,
        limit = limit,
        onDismiss = { mark(listOf(it.id)) },
        onClear = { mark(list.map { it.id }) },
        onCopy = { it.code?.let { code -> com.hengxin.aioa.ui.chat.copyCode(context, code) } },
    ) {
        mark(listOf(it.id))
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
internal fun items(feed: FeedState, priority: String, now: Long = System.currentTimeMillis()): List<FeedItem> =
    feed.layers[priority].orEmpty().filter { it.ev.kind != Constants.KIND_TASK }.map { it.toFeed(now) }

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
internal fun ResourceTiles(chat: ChatModel, open: (Tab) -> Unit) {
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
