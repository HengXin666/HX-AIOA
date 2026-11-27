package com.hengxin.aioa.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
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
import com.hengxin.aioa.Constants
import com.hengxin.aioa.data.Lifetime
import com.hengxin.aioa.data.MessageDb
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Chip
import com.hengxin.aioa.kit.ComboChart
import com.hengxin.aioa.kit.ComboKind
import com.hengxin.aioa.kit.ComboLegend
import com.hengxin.aioa.kit.ComboSeries
import com.hengxin.aioa.kit.CountUp
import com.hengxin.aioa.kit.LiveDot
import com.hengxin.aioa.kit.Panel
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.chartPalette
import com.hengxin.aioa.kit.TodoRow
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.LocalDate
import java.time.ZoneId

// 总览 "你和 Agent 一起" (#140, #142): 今天 / 本周的混合图, 数据全部来自本机 (消息库, 已拉到的待办), 不另发请求

private const val HOUR_MS = 3_600_000L
private const val STREAK_DAYS = 400
private const val HUNDRED = 100

/**
 * 线: 我发的, Agent 发的 (按小时或按天); 柱: 完成的待办; 点: 我 + Agent 最多的那一格。
 * 下面一排是本机累计的事实数据 (连续活跃, 最忙一天, Agent 占比, 等你处理), 不自定成就。
 */
@Composable
internal fun Pulse(chat: ChatModel, agentSids: Set<String>, needMe: Int, modifier: Modifier, openReport: () -> Unit) {
    val c = Aioa.colors
    val pal = chartPalette()
    val db = MessageDb.get(LocalContext.current)
    var span by rememberSaveable { mutableStateOf(PulseSpan.DAY) }
    // 已完成待办: 总览的重点待办已经拉过全部待办, 这里只读缓存; 没拉到 (没装待办插件) 就不画柱
    val todos: List<TodoRow>? = chat.spaces.allTodos()
    val doneAt = todos?.filter { it.state == TodoRow.STATE_DONE }?.mapNotNull { it.doneAt }.orEmpty()
    // 新消息进来, 换了小时, 切了今天 / 本周, 待办变了: 重算
    val hour = System.currentTimeMillis() / HOUR_MS
    val state = produceState<Pair<PulseData, Lifetime>?>(null, chat.messages.size, hour, span, agentSids, doneAt) {
        value = withContext(Dispatchers.IO) {
            val zone = ZoneId.systemDefault()
            val now = System.currentTimeMillis()
            val from = PulseMath.from(span, LocalDate.now(zone), zone)
            PulseMath.build(span, db.weekRows(from, now + 1), agentSids, doneAt, now, zone) to db.lifetime(agentSids, STREAK_DAYS)
        }
    }.value
    Panel(modifier.fillMaxWidth()) {
        Row(Modifier.padding(start = 16.dp, end = 12.dp, top = 14.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("你和 ${Constants.CLOUD_AGENT} 一起", c.text, 15, weight = FontWeight.SemiBold)
            Spacer(Modifier.weight(1f))
            LiveDot(c.success, 6.dp)
            Text("实时", c.textSecondary, 12)
            Spacer(Modifier.width(10.dp))
            Chip("周报", false, openReport)
        }
        Row(Modifier.padding(start = 16.dp, end = 16.dp, top = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            PulseSpan.entries.forEach { s -> Chip(s.label, span == s) { span = s } }
            Spacer(Modifier.weight(1f))
            state?.first?.peakLabel?.let { Text("峰值 $it · ${state.first.peakCount} 条", pal.warning, 12, weight = FontWeight.Medium) }
        }
        val (d, life) = state ?: return@Panel
        val me = ComboSeries("我", d.mine, pal.primary, ComboKind.AREA)
        val agent = ComboSeries(Constants.CLOUD_AGENT, d.agent, pal.accent)
        val done = ComboSeries("完成待办", d.done, pal.success, ComboKind.BAR)
        val series = if (todos == null) listOf(me, agent) else listOf(done, me, agent)
        Row(Modifier.padding(start = 16.dp, end = 16.dp, top = 10.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            ComboLegend(me, "${d.mineTotal}")
            ComboLegend(agent, "${d.agentTotal}")
            if (todos != null) ComboLegend(done, "${d.doneTotal}")
        }
        ComboChart(
            d.labels, series, Modifier.padding(start = 12.dp, end = 16.dp, top = 6.dp),
            marker = d.peak, markerColor = pal.warning, ticks = d.ticks, delayMs = 150,
        )
        val today = LocalDate.now()
        val agentPct = if (life.total == 0) 0 else life.agent * HUNDRED / life.total
        Row(Modifier.padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 14.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Feat(streakOf(life.perDay, today), "天连续活跃", pal.amber, 300, Modifier.weight(1f))
            Feat(life.perDay.values.maxOrNull() ?: 0, "条最忙一天", pal.primary, 380, Modifier.weight(1f))
            Feat(agentPct, "% 是 Agent", pal.accent, 460, Modifier.weight(1f))
            Feat(needMe, "条等你", if (needMe > 0) pal.danger else pal.neutral, 540, Modifier.weight(1f))
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
