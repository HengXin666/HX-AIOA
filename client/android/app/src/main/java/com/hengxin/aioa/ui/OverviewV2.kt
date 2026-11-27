package com.hengxin.aioa.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.Constants
import com.hengxin.aioa.data.MessageDb
import com.hengxin.aioa.kit.AnimatedItems
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.AreaChart
import com.hengxin.aioa.kit.CardState
import com.hengxin.aioa.kit.CountUp
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.LiveDot
import com.hengxin.aioa.kit.Meter
import com.hengxin.aioa.kit.Panel
import com.hengxin.aioa.kit.Ring
import com.hengxin.aioa.kit.SectionTitle
import com.hengxin.aioa.kit.SoftTag
import com.hengxin.aioa.kit.TaskCard
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.enter
import com.hengxin.aioa.kit.hxPalette
import com.hengxin.aioa.kit.pointerTap
import com.hengxin.aioa.ui.agents.triggerView
import com.hengxin.aioa.ui.chat.ChatAgent
import com.hengxin.aioa.ui.chat.ChatMeta
import com.hengxin.aioa.ui.chat.MentionOps
import com.hengxin.aioa.ui.chat.SenderFace
import com.hengxin.aioa.ui.chat.Senders
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// 总览 v2 (#121): 概况, 今日脉搏, 需要我, Agent, 重点待办, 正在发生, 资源, 值得一看。
// 图表数据全在本地算 (消息库, 群资料缓存, 已有的探针推送), 打开总览不多发请求。

private const val HOURS = 24
private const val HOUR_MS = 3_600_000L
private const val MINUTE_MS = 60_000L
private const val AGENTS_SHOWN = 8
private const val HOSTS_SHOWN = 3
private const val TREND_POINTS = 30
private const val KEY_MEMORY = "mem"
private const val FULL_PCT = 100f
private const val NEED_SHOWN = 5
private const val LAYER_SHOWN = 3
private const val STREAK_DAYS = 400
private const val HUNDRED = 100
private val CLOCK = 150.dp

@Composable
internal fun OverviewV2(chat: ChatModel, state: CardState, open: (Tab) -> Unit, openGithub: () -> Unit, show: (String) -> Unit) {
    val c = Aioa.colors
    val feed = chat.feed
    val waiting = feed.tasks.values.filter { it.state == Constants.TASK_WAITING }.sortedByDescending { it.updated }
    val running = feed.tasks.values.count { it.state == Constants.TASK_RUNNING }
    val needMe = items(feed, Constants.PRIORITY_NEED_ME).count { !chat.seen.has(it.id) } + waiting.size
    val agents = chat.groups.directory.metas.values.filter { it.deleted == 0L }.flatMap { m -> m.agents.map { m to it } }
    // 周报 (#140): 从下面 "你和 Agent 一起" 的右上角进入, 整页叠在上面
    var report by androidx.compose.runtime.saveable.rememberSaveable { androidx.compose.runtime.mutableStateOf(false) }
    if (report) com.hengxin.aioa.ui.report.WeeklyReportDialog(chat) { report = false }
    Column(Modifier.padding(start = 4.dp, bottom = 4.dp).enter(0), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(remember { SimpleDateFormat("EEEE · M 月 d 日", Locale.CHINA).format(Date()) }, c.textSecondary, 13)
        Text(if (needMe > 0) "$needMe 件事等你决定" else "一切正常", c.text, 26, weight = FontWeight.SemiBold)
        Row(verticalAlignment = Alignment.CenterVertically) {
            LiveDot(if (chat.online) c.success else c.danger, 7.dp)
            Text(if (chat.online) "已连接 · ${agents.size} 个${Constants.CLOUD_AGENT} · $running 个任务在跑" else "未连接, 正在重连", c.textSecondary, 14)
        }
    }
    Pulse(chat, agents.mapNotNull { it.second.sourceId }.toSet(), needMe, Modifier.enter(1)) { report = true }
    Column(Modifier.enter(2), verticalArrangement = Arrangement.spacedBy(Aioa.metrics.gap)) {
        val answer = rememberAnswer(chat)
        AnimatedItems(waiting, { it.id }) { task ->
            TaskCard(task.toCard(feed.pending[task.id]), onOption = { answer(task, it) }) { open(Tab.AGENT) }
        }
        Layer(chat, "需要我", "少而重要", Constants.PRIORITY_NEED_ME, state, "一切正常, 没有需要处理的事", NEED_SHOWN, show)
    }
    if (agents.isNotEmpty()) {
        Column(Modifier.enter(3)) {
            SectionTitle(Constants.CLOUD_AGENT, agents.size, action = "消息", onAction = { open(Tab.CHAT) })
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                agents.take(AGENTS_SHOWN).forEachIndexed { i, (m, a) -> AgentTile(m, a, i) { chat.groups.openGroup(m.channel); open(Tab.CHAT) } }
            }
        }
    }
    Column(Modifier.enter(4)) { com.hengxin.aioa.ui.todo.TodoFocus(chat.spaces) { ch, seq -> chat.groups.openAt(ch, seq) } }
    Column(Modifier.enter(5)) { Layer(chat, "正在发生", "不必立即处理", Constants.PRIORITY_HAPPENING, state, "暂时风平浪静", LAYER_SHOWN, show) }
    Hosts(chat, open, Modifier.enter(6))
    Column(Modifier.enter(7)) { Layer(chat, "值得一看", "日报, 周报与摘要", Constants.PRIORITY_WORTH_READING, state, "今天没有新内容", LAYER_SHOWN, show) }
}

/**
 * 你和 Agent 一起做了多少 (#140): 只放事实数据, 不自定成就与里程碑。
 * 左边 24 小时放射钟 (每小时一根光线, 现在这一小时在呼吸), 右边累计消息与本机记录天数,
 * 下面连续活跃 / 最忙一天 / Agent 占比 / 等你处理。全部本地算, 新消息进来时重算。
 */
@Composable
private fun Pulse(chat: ChatModel, agentSids: Set<String>, needMe: Int, modifier: Modifier, openReport: () -> Unit) {
    val c = Aioa.colors
    val pal = hxPalette()
    val db = MessageDb.get(LocalContext.current)
    val since = (System.currentTimeMillis() / HOUR_MS - (HOURS - 1)) * HOUR_MS
    val data = produceState<Pair<IntArray, com.hengxin.aioa.data.Lifetime>?>(null, chat.messages.size, since, agentSids) {
        value = withContext(Dispatchers.IO) { db.hourly(since, HOURS, agentSids).first to db.lifetime(agentSids, STREAK_DAYS) }
    }.value ?: return
    val (all, life) = data
    val today = java.time.LocalDate.now()
    val streak = streakOf(life.perDay, today)
    val best = life.perDay.values.maxOrNull() ?: 0
    val together = if (life.first <= 0) 0 else java.time.temporal.ChronoUnit.DAYS.between(
        java.time.Instant.ofEpochMilli(life.first).atZone(java.time.ZoneId.systemDefault()).toLocalDate(), today,
    ).toInt() + 1
    val agentPct = if (life.total == 0) 0 else life.agent * HUNDRED / life.total
    Panel(modifier.fillMaxWidth()) {
        Row(Modifier.padding(start = 16.dp, end = 12.dp, top = 14.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("你和 ${Constants.CLOUD_AGENT} 一起", c.text, 15, weight = FontWeight.SemiBold)
            Spacer(Modifier.weight(1f))
            LiveDot(pal.chart2, 6.dp)
            Text("实时", c.textSecondary, 12)
            Spacer(Modifier.width(10.dp))
            com.hengxin.aioa.kit.Chip("周报", true, openReport)
        }
        Row(Modifier.padding(start = 8.dp, end = 16.dp, top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            com.hengxin.aioa.kit.RadialBars(all.map { it.toFloat() }, pal.chart1, pal.chart2, Modifier.size(CLOCK), highlight = HOURS - 1, delayMs = 150) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    CountUp(all.sum(), 22, c.text, delayMs = 150)
                    Text("近 24 小时", c.textSecondary, 11)
                }
            }
            Column(Modifier.weight(1f).padding(start = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                CountUp(life.total, 32, c.text, delayMs = 250)
                Text("条消息往来 · ${life.groups} 个群", c.textSecondary, 12)
                Text(if (together > 1) "本机记录 $together 天" else "今天开始记录", pal.chart2, 13, weight = FontWeight.Medium)
            }
        }
        Row(Modifier.padding(start = 16.dp, end = 16.dp, top = 10.dp, bottom = 14.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Feat(streak, "天连续活跃", pal.chart3, 300, Modifier.weight(1f))
            Feat(best, "条最忙一天", pal.chart1, 380, Modifier.weight(1f))
            Feat(agentPct, "% 是 Agent", pal.chart2, 460, Modifier.weight(1f))
            Feat(needMe, "条等你", if (needMe > 0) c.danger else c.textSecondary, 540, Modifier.weight(1f))
        }
    }
}

/** 一项事实数据: 数字从 0 滚上来, 下面一行说明, 底色是它自己的颜色。 */
@Composable
private fun Feat(n: Int, label: String, tone: Color, delay: Int, modifier: Modifier) {
    Column(modifier.clip(RoundedCornerShape(12.dp)).background(tone.copy(alpha = 0.12f)).padding(horizontal = 8.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        CountUp(n, 18, tone, delayMs = delay)
        Text(label, Aioa.colors.textSecondary, 11)
    }
}

/** 到今天为止连续有消息的天数; 今天还没消息就从昨天往前数。 */
internal fun streakOf(perDay: Map<String, Int>, today: java.time.LocalDate): Int {
    var d = if ((perDay[today.toString()] ?: 0) > 0) today else today.minusDays(1)
    var n = 0
    while ((perDay[d.toString()] ?: 0) > 0) {
        n++
        d = d.minusDays(1)
    }
    return n
}

/** 一个 Agent: 环是 "从上次运行到下次触发" 走了多少; 逾期标红, 没上报触发方式时只显示名字。 */
@Composable
private fun AgentTile(meta: ChatMeta, a: ChatAgent, i: Int, onClick: () -> Unit) {
    val c = Aioa.colors
    val pal = hxPalette()
    val tone = listOf(pal.chart2, pal.chart3, pal.chart4, pal.chart5)[i % 4]
    val now = System.currentTimeMillis()
    val view = a.trigger?.let { triggerView(it, a.lastRun, now) }
    val next = view?.next
    val last = a.lastRun
    val f = if (next != null && last != null && next > last) ((now - last).toFloat() / (next - last)).coerceIn(0f, 1f) else 0f
    val step = when {
        a.pending -> "等它重新接入" to c.warning
        view?.late == true -> "超时未运行" to c.danger
        next != null -> "约 ${((next - now) / MINUTE_MS).coerceAtLeast(1)} 分钟后运行" to tone
        else -> "没上报触发方式" to c.textSecondary
    }
    Panel(Modifier.width(158.dp).pointerTap(onClick)) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                Ring(f, step.second, Modifier.size(52.dp), delayMs = 300 + i * 120) {
                    // 主人给群 Agent 设了头像 (#121) 就放头像, 否则 bot 图标
                    if (Senders.avatarOf(a.sourceId) != null) SenderFace(a.sourceId, "", 32.dp, agent = true) else Icon("bot", tone, 20.dp)
                }
                Spacer(Modifier.weight(1f))
                if (a.plugin != null) SoftTag("插件", c.textSecondary)
            }
            Spacer(Modifier.height(12.dp))
            Text(MentionOps.agentName(a), c.text, 15, weight = FontWeight.SemiBold)
            Text(meta.title ?: meta.channel, c.textSecondary, 13)
            Text(step.first, step.second, 12, Modifier.padding(top = 6.dp), weight = FontWeight.Medium)
        }
    }
}

/** 资源: 每台主机一块, 分段负载条 + CPU 走势; 数据来自已有的探针推送。 */
@Composable
private fun Hosts(chat: ChatModel, open: (Tab) -> Unit, modifier: Modifier) {
    val c = Aioa.colors
    val pal = hxPalette()
    val m = chat.metrics
    val hosts = m.hosts.take(HOSTS_SHOWN)
    if (hosts.isEmpty()) return
    Column(modifier) {
        SectionTitle(Tab.RESOURCES.label, m.hosts.count { it.online }, action = "全部", onAction = { open(Tab.RESOURCES) })
        Panel(Modifier.fillMaxWidth().pointerTap { open(Tab.RESOURCES) }) {
            hosts.forEachIndexed { i, h ->
                if (i > 0) Box(Modifier.fillMaxWidth().height(1.dp).background(c.border.copy(alpha = 0.5f)))
                val tone = listOf(pal.chart2, pal.chart5, pal.chart3)[i % 3]
                val cpu = m.series(h.subject, KEY_CPU).takeLast(TREND_POINTS)
                // 推送还没到 (首屏, 离线主机) 就用主机卡片里探针的最后一次快照 (#139)
                val mem = m.series(h.subject, KEY_MEMORY).lastOrNull()?.second ?: h.last?.values?.get(KEY_MEMORY)?.toFloat()
                Column(Modifier.fillMaxWidth().padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(h.hostname ?: h.subject, c.text, 15, weight = FontWeight.SemiBold)
                        Text(h.os.orEmpty(), c.textSecondary, 12, Modifier.weight(1f))
                        SoftTag(if (h.online) "在线" else "离线", if (h.online) c.success else c.textSecondary)
                    }
                    Row(Modifier.padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Load("CPU", cpu.lastOrNull()?.second ?: h.last?.values?.get(KEY_CPU)?.toFloat(), tone)
                            Load("内存", mem, tone)
                        }
                        if (cpu.size >= 2) AreaChart(cpu.map { it.second }, tone, Modifier.width(96.dp).height(44.dp), delayMs = 500, grid = false)
                    }
                }
            }
        }
    }
}

@Composable
private fun Load(label: String, pct: Float?, tone: Color) {
    val c = Aioa.colors
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, c.textSecondary, 12, Modifier.width(30.dp))
        Meter((pct ?: 0f) / FULL_PCT, tone, Modifier.weight(1f).height(8.dp), segments = 20, delayMs = 400)
        Text(pct?.let { "${it.toInt()}%" } ?: "-", c.text, 12, Modifier.width(34.dp), weight = FontWeight.Medium)
    }
}
