package com.hengxin.aioa.ui.report

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.data.LocalTally
import com.hengxin.aioa.data.ReportSpan
import com.hengxin.aioa.data.Tally
import com.hengxin.aioa.data.WeekReport
import com.hengxin.aioa.data.WeekReports
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Card
import com.hengxin.aioa.kit.CardState
import com.hengxin.aioa.kit.Chip
import com.hengxin.aioa.kit.CountUp
import com.hengxin.aioa.kit.Panel
import com.hengxin.aioa.kit.SoftTag
import com.hengxin.aioa.kit.StateBody
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.enter
import com.hengxin.aioa.kit.hxPalette
import com.hengxin.aioa.ui.ChatModel
import com.hengxin.aioa.ui.SubPage
import com.hengxin.aioa.ui.chat.Names
import com.hengxin.aioa.ui.chat.Senders
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.IsoFields

// 周报页 (#140), 按 docs/design/weekly-report/prototype.html 落地; 数据全在本机算, 只有插件数进页时问一次服务端

private val DAYS = listOf("一", "二", "三", "四", "五", "六", "日")
private const val PEERS_SHOWN = 8
private const val ORBIT_MAX = 14
private const val MIN_MS = 60_000L
private const val PCT = 100
private val LAT_LABELS = listOf("<25", "50", "100", "200", "400", "800", "1.6s", "3.2s", "更慢")

/** 周报: 平台使用, 消息, 人际, 配置, 本机记录, GitHub 一角; 可以翻到上一周。 */
@Composable
fun WeeklyReport(chat: ChatModel, onBack: () -> Unit) {
    val context = LocalContext.current
    var back by rememberSaveable { mutableIntStateOf(0) }
    val span = ReportSpan.WEEK
    val first = span.first(LocalDate.now(), back)
    val zone = ZoneId.systemDefault()
    val agentSids = chat.groups.directory.metas.values.flatMap { m -> m.agents.mapNotNull { it.sourceId } }.toSet()
    val report = produceState<WeekReport?>(null, first) {
        value = withContext(Dispatchers.IO) { WeekReports.load(context, span, first, { it in agentSids || Names.isAgent(it) }, zone) }
    }.value
    val counts = rememberConfigCounts(chat, first.atStartOfDay(zone).toInstant().toEpochMilli())
    SubPage("周报", onBack) {
        Header(first, back) { back = it }
        if (report == null) return@SubPage Card { StateBody(CardState.Loading) {} }
        Hero(report, Modifier.enter(0))
        Usage(report, Modifier.enter(1))
        Messages(report, Modifier.enter(2))
        People(report, Modifier.enter(3))
        Configs(counts, Modifier.enter(4))
        Local(report, Modifier.enter(5))
        Github(chat, report, Modifier.enter(6))
        Text("数据口径: 前台时长是 App 回到前台到离开前台的本机记录; 消息来自本机消息库, 撤回的不算, 我看过的 = 已读位置之内或单独看过; 请求, 流量, 终端, 通知, 电量都是本机记录, 不上传, 从这一版起开始累计。", Aioa.colors.textSecondary, 12, maxLines = 6)
    }
}

@Composable
private fun Header(first: LocalDate, back: Int, pick: (Int) -> Unit) {
    val c = Aioa.colors
    val end = first.plusDays(6)
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("第 ${first.get(IsoFields.WEEK_OF_WEEK_BASED_YEAR)} 周 · ${first.monthValue}.${first.dayOfMonth} - ${end.monthValue}.${end.dayOfMonth}", c.text, 22, weight = FontWeight.SemiBold)
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Chip("本周", back == 0) { pick(0) }
            Chip("上周", back == 1) { pick(1) }
            ReportSpan.entries.filter { !it.ready }.forEach { SoftTag("${it.label} 即将推出", c.textSecondary) }
        }
    }
}

@Composable
private fun Hero(r: WeekReport, modifier: Modifier) {
    val c = Aioa.colors
    val pal = hxPalette()
    val mins = (r.usage.totalMs / MIN_MS).toInt()
    Section("这一周, 你在 HX-AIOA 上", modifier) {
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            CountUp(mins / 60, 44, c.text)
            Text("小时", c.textSecondary, 15, Modifier.padding(bottom = 8.dp))
            CountUp(mins % 60, 44, c.text, delayMs = 100)
            Text("分", c.textSecondary, 15, Modifier.padding(bottom = 8.dp))
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("前台时长", c.textSecondary, 13)
            delta(r.usage.totalMs, r.prevUsageMs)?.let { SoftTag(it, if (it.startsWith("+")) c.success else c.danger) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Kpi(r.usage.opens, "打开次数", c.text, Modifier.weight(1f))
            Kpi(r.msgs.total, "条消息", c.text, Modifier.weight(1f))
            Kpi(r.msgs.peers.size, "个交流对象", c.text, Modifier.weight(1f))
            Kpi(r.sum(Tally.REQ).toInt(), "次请求", c.text, Modifier.weight(1f))
        }
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            WeekClock(r.usage.minutes, pal.chart2, pal.chart5, pal.chart4, Modifier.size(260.dp)) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    CountUp(mins, 20, c.text, delayMs = 200)
                    Text("分钟", c.textSecondary, 11)
                }
            }
        }
        Text("每一圈是一天 (内圈周一), 每一格是一小时, 越亮用得越久", c.textSecondary, 11, maxLines = 2)
    }
}

@Composable
private fun Usage(r: WeekReport, modifier: Modifier) {
    val c = Aioa.colors
    val pal = hxPalette()
    val u = r.usage
    val perDay = u.minutes.map { it.sum().toLong() }
    val byHour = IntArray(24) { h -> u.minutes.sumOf { it[h] } }
    val peak = byHour.indices.maxByOrNull { byHour[it] }?.takeIf { byHour[it] > 0 }
    Section("01 平台使用", modifier) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Stat(if (u.opens > 0) "${u.totalMs / MIN_MS / u.opens} 分" else "-", "平均每次", Modifier.weight(1f))
            Stat(u.longest?.let { "${it.ms / MIN_MS} 分" } ?: "-", "最长一次", Modifier.weight(1f))
            Stat(peak?.let { "$it - ${it + 1} 点" } ?: "-", "最活跃时段", Modifier.weight(1f))
        }
        DayBars(perDay, perDay.map { if (it >= 60) "${it / 60}h${it % 60}" else "${it}m" }, emptyList(), DAYS.map { "周$it" }, pal.chart2, pal.chart5, Modifier.fillMaxWidth().height(170.dp))
        Text("一天里什么时候在用 (本周合计分钟)", c.textSecondary, 12)
        com.hengxin.aioa.kit.AreaChart(byHour.map { it.toFloat() }, pal.chart2, Modifier.fillMaxWidth().height(90.dp), delayMs = 300)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { listOf("0 点", "6 点", "12 点", "18 点", "23 点").forEach { Text(it, c.textSecondary, 11) } }
    }
}

@Composable
private fun Messages(r: WeekReport, modifier: Modifier) {
    val c = Aioa.colors
    val pal = hxPalette()
    val m = r.msgs
    val incoming = m.agent + m.human
    val colors = listOf(pal.chart5, pal.chart2, pal.chart3)
    Section("02 消息", modifier) {
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            Donut(listOf(m.mine to colors[0], m.agent to colors[1], m.human to colors[2]), Modifier.size(200.dp)) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    CountUp(m.total, 30, c.text)
                    Text(delta(m.total.toLong(), r.prevMsgs.toLong())?.let { "比上周 $it" } ?: "条消息", c.textSecondary, 11)
                }
            }
        }
        Legend(listOf("我发出 ${m.mine}" to colors[0], "Agent 发来 ${m.agent}" to colors[1], "真人发来 ${m.human}" to colors[2]))
        StackBars(m.perDay, colors, List(r.days) { d -> viewedOf(m.perDay[d], m.viewed, incoming) }, DAYS.map { "周$it" }, c.text, Modifier.fillMaxWidth().height(150.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Stat("$incoming → ${m.viewed}", "别人发来 → 我看过" + if (incoming > 0) " (${m.viewed * PCT / incoming}%)" else "", Modifier.weight(1.4f))
            Stat(if (m.total > 0) "${m.agent * PCT / m.total}%" else "-", "由 Agent 发出", Modifier.weight(1f))
            Stat("${m.groups}", "个群有动静", Modifier.weight(1f))
        }
        Text("白线按每天别人发来的比例摊开 \"我看过的\", 只是示意", c.textSecondary, 11, maxLines = 2)
    }
}

/** 每天 "我看过的" 没有逐天记录, 按当天别人发来的占比把一周总数摊开。 */
private fun viewedOf(day: IntArray, viewed: Int, incoming: Int): Int =
    if (incoming <= 0) 0 else (day[1] + day[2]) * viewed / incoming

@Composable
private fun People(r: WeekReport, modifier: Modifier) {
    val c = Aioa.colors
    val pal = hxPalette()
    val peers = r.msgs.peers
    if (peers.isEmpty()) return
    val name = { sid: String, fallback: String -> Senders.aliasOf(sid) ?: fallback }
    Section("03 人际 · 我和谁在交流", modifier) {
        Orbit(peers.take(ORBIT_MAX).map { OrbitPeer(name(it.sid, it.name), it.count, it.agent) }, pal.chart5, pal.chart2, pal.chart3, Modifier.fillMaxWidth().height(280.dp))
        Legend(listOf("Agent (内圈)" to pal.chart2, "真人 (外圈)" to pal.chart3))
        val mx = peers.first().count.coerceAtLeast(1)
        peers.take(PEERS_SHOWN).forEachIndexed { i, p ->
            val tone = if (p.agent) pal.chart2 else pal.chart3
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("${i + 1}", c.textSecondary, 12)
                    Text(name(p.sid, p.name), c.text, 14, Modifier.weight(1f, fill = false))
                    SoftTag(if (p.agent) "Agent" else "真人", tone)
                    Box(Modifier.weight(1f))
                    Text("${p.count}", c.text, 14, weight = FontWeight.SemiBold)
                }
                Box(Modifier.fillMaxWidth().height(5.dp).clip(RoundedCornerShape(3.dp)).background(c.surfaceAlt)) {
                    Box(Modifier.fillMaxWidth(p.count.toFloat() / mx).height(5.dp).clip(RoundedCornerShape(3.dp)).background(tone))
                }
            }
        }
        Text("按别人发来的条数排; 共 ${peers.size} 位 (前 12)", c.textSecondary, 11)
    }
}

@Composable
private fun Configs(counts: List<ConfigCount>, modifier: Modifier) {
    val c = Aioa.colors
    val pal = hxPalette()
    val tones = listOf(pal.chart2, pal.chart4, pal.chart2, pal.chart3, pal.chart5)
    Section("04 我配置了多少", modifier) {
        counts.chunked(2).forEachIndexed { row, pair ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                pair.forEachIndexed { k, item ->
                    val tone = tones[(row * 2 + k) % tones.size]
                    Column(Modifier.weight(1f).clip(RoundedCornerShape(14.dp)).background(tone.copy(alpha = 0.08f)).padding(12.dp)) {
                        if (item.value != null) CountUp(item.value, 24, c.text, delayMs = 60 * (row * 2 + k)) else Text("-", c.textSecondary, 24)
                        Text(item.label, c.text, 13)
                        Text(item.note, c.textSecondary, 11)
                    }
                }
                if (pair.size == 1) Box(Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun Local(r: WeekReport, modifier: Modifier) {
    val c = Aioa.colors
    val pal = hxPalette()
    val lat = LocalTally.latency(r.tally)
    val req = r.sum(Tally.REQ)
    val b = r.battery
    Section("05 本机记录 · 不在数据库里的", modifier) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Stat(bytes(r.sum(Tally.NET_DOWN) + r.sum(Tally.NET_UP)), "流量 (已知长度)", Modifier.weight(1f))
            Stat("${r.sum(Tally.FILES)} 个", "上传文件 ${bytes(r.sum(Tally.FILE_UP))}", Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Stat("${r.sum(Tally.TERM)} 次", "终端 · 共 ${r.sum(Tally.TERM_MS) / MIN_MS} 分", Modifier.weight(1f))
            Stat("${r.sum(Tally.NOTIFY)} 条", "通知", Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Stat("$req", "次请求 · 失败 ${if (req > 0) r.sum(Tally.REQ_FAIL) * PCT / req else 0}%", Modifier.weight(1f))
            Stat(ms(LocalTally.percentile(lat, 0.5)), "中位耗时", Modifier.weight(1f))
            Stat(ms(LocalTally.percentile(lat, 0.95)), "P95", Modifier.weight(1f))
        }
        if (req > 0) {
            val tones = List(lat.size) { i -> if (i >= 6) c.danger else if (i >= 4) pal.chart3 else pal.chart2 }
            Histogram(lat, tones, LAT_LABELS, Modifier.fillMaxWidth().height(90.dp))
        }
        val from = r.first.atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli()
        BatteryRange(b.points, from, from + r.days * 86_400_000L, pal.chart2, c.success, pal.chart1.copy(alpha = 0.08f), Modifier.fillMaxWidth().height(90.dp))
        val on = b.perHour(b.onMs, b.onDrop)
        val off = b.perHour(b.offMs, b.offDrop)
        Text(if (on == null && off == null) "电量: 采样不足" else "整机电量: 熄屏 ${off?.let { "-%.1f%%/小时".format(it) } ?: "-"}, 亮屏 ${on?.let { "-%.1f%%/小时".format(it) } ?: "-"}", c.textSecondary, 12)
    }
}

@Composable
private fun Github(chat: ChatModel, r: WeekReport, modifier: Modifier) {
    val days = chat.github.mine.daily?.days ?: return
    if (!chat.github.enabled) return
    val keys = (0 until r.days).map { r.first.plusDays(it.toLong()).toString() }.toSet()
    val week = days.filter { it.day in keys }
    if (week.isEmpty()) return
    val pal = hxPalette()
    val c = Aioa.colors
    val mx = week.maxOf { it.commits }.coerceAtLeast(1)
    Section("06 GitHub 一角", modifier) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Stat("${week.sumOf { it.commits }}", "本周提交", Modifier.weight(1f))
            Stat("${week.sumOf { it.prMerged }}", "PR 合并", Modifier.weight(1f))
            Stat("${week.sumOf { it.issueClosed }}", "Issue 关闭", Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            week.forEach { d ->
                Box(Modifier.weight(1f).height(34.dp).clip(RoundedCornerShape(8.dp)).background(pal.chart4.copy(alpha = 0.15f + 0.85f * d.commits / mx)), contentAlignment = Alignment.Center) {
                    Text("${d.commits}", c.text, 12, weight = FontWeight.SemiBold)
                }
            }
        }
    }
}

@Composable
private fun Section(title: String, modifier: Modifier, content: @Composable ColumnScope.() -> Unit) {
    Panel(modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(title, Aioa.colors.textSecondary, 13, weight = FontWeight.Medium)
            content()
        }
    }
}

@Composable
private fun Kpi(n: Int, label: String, tone: Color, modifier: Modifier) {
    Column(modifier.clip(RoundedCornerShape(12.dp)).background(Aioa.colors.surfaceAlt.copy(alpha = 0.6f)).padding(10.dp)) {
        CountUp(n, 18, tone)
        Text(label, Aioa.colors.textSecondary, 11)
    }
}

@Composable
private fun Stat(value: String, label: String, modifier: Modifier) {
    Column(modifier) {
        Text(value, Aioa.colors.text, 18, weight = FontWeight.SemiBold)
        Text(label, Aioa.colors.textSecondary, 11, maxLines = 2)
    }
}

@Composable
private fun Legend(items: List<Pair<String, Color>>) {
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        items.forEach { (label, color) ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                Box(Modifier.size(8.dp).clip(RoundedCornerShape(2.dp)).background(color))
                Text(label, Aioa.colors.textSecondary, 12)
            }
        }
    }
}

/** 与上一段比的变化, 如 "+18%"; 上一段为 0 时不比。 */
internal fun delta(now: Long, prev: Long): String? {
    if (prev <= 0) return null
    val d = ((now - prev) * PCT / prev).toInt()
    return if (d >= 0) "+$d%" else "$d%"
}

internal fun bytes(n: Long): String = when {
    n >= 1L shl 30 -> "%.1f GB".format(n / (1L shl 30).toDouble())
    n >= 1L shl 20 -> "%.1f MB".format(n / (1L shl 20).toDouble())
    n >= 1L shl 10 -> "${n shr 10} KB"
    else -> "$n B"
}

private fun ms(v: Long): String = when {
    v < 0 -> "> 3.2 s"
    v == 0L -> "-"
    else -> "< $v ms"
}
