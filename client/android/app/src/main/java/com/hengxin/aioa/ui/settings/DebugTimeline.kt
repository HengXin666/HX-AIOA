package com.hengxin.aioa.ui.settings

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.hxPalette
import com.hengxin.aioa.link.DebugReport
import com.hengxin.aioa.link.LinkLog
import com.hengxin.aioa.link.LinkStats
import com.hengxin.aioa.link.LinkStatsHistory
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.LocalDateTime
import java.time.ZoneId

// 调试模式的连接与唤醒时间线 (#141): 上面是近 24 小时的事件 (每条记录一根刻度, 分道),
// 下面是计数按小时摊开 (LinkStats 快照相邻两次的差)。都从已有的本机日志现算, 不额外唤醒。

private const val HOURS = 24
private const val HOUR_MS = 3_600_000L
private const val WINDOW_MS = HOURS * HOUR_MS
private val LANE_H = 16.dp

/** 事件分道: 顺序即从上到下。 */
enum class Lane(val label: String) { LINK("后台建连"), DROP("断线 / 重连"), WATCH("看门狗"), UI("界面连接"), CORE("服务 / 内核") }

/** 一条长连接记录归到哪一道; 收帧等不归道的返回 null。 */
fun laneOf(event: String): Lane? = when {
    event.contains(DebugReport.UI_PREFIX) -> if (event.contains("已连接")) Lane.UI else null
    listOf("断", "重连", "已死", "失败").any { it in event } -> Lane.DROP
    listOf("看门狗", "亮屏检查", "心跳").any { it in event } -> Lane.WATCH
    event.contains("已连接") -> Lane.LINK
    listOf("后台服务", "代理内核", "维护", "订阅").any { it in event } -> Lane.CORE
    else -> null
}

/** "MM-dd HH:mm:ss 事件" 的时间; 日志不带年份, 取离 now 最近且不晚于 now 一天的那一年。 */
fun linkTime(line: String, now: Long, zone: ZoneId): Long? {
    if (line.length < CLOCK_LEN) return null
    val head = line.substring(0, CLOCK_LEN)
    val nowDt = LocalDateTime.ofInstant(java.time.Instant.ofEpochMilli(now), zone)
    return runCatching {
        val mo = head.substring(0, 2).toInt()
        val d = head.substring(3, 5).toInt()
        val t = java.time.LocalTime.parse(head.substring(6))
        var at = LocalDateTime.of(nowDt.year, mo, d, t.hour, t.minute, t.second)
        if (at.isAfter(nowDt.plusDays(1))) at = at.minusYears(1)
        at.atZone(zone).toInstant().toEpochMilli()
    }.getOrNull()
}

private const val CLOCK_LEN = 14

/** 计数时间线里画哪些项。 */
private val COUNTED = listOf(LinkStats.Key.CONNECT, LinkStats.Key.DISCONNECT, LinkStats.Key.ALARM, LinkStats.Key.SCREEN, LinkStats.Key.NETWORK, LinkStats.Key.PROBE, LinkStats.Key.RX)

private class Timeline(val events: List<Pair<Long, Lane>>, val counts: List<Pair<LinkStats.Key, IntArray>>, val from: Long, val to: Long)

@Composable
fun LinkTimelineVisual(tick: Int) {
    val context = LocalContext.current
    val data = produceState<Timeline?>(null, tick) {
        value = withContext(Dispatchers.IO) {
            val now = System.currentTimeMillis()
            val from = (now / HOUR_MS + 1) * HOUR_MS - WINDOW_MS
            val zone = ZoneId.systemDefault()
            val events = LinkLog.recent(context, LinkLog.KEEP_LINES).mapNotNull { l ->
                val at = linkTime(l, now, zone) ?: return@mapNotNull null
                val lane = laneOf(l.substring(CLOCK_LEN)) ?: return@mapNotNull null
                if (at < from) null else at to lane
            }
            val snaps = LinkStatsHistory.read(context, from - HOUR_MS)
            val counts = COUNTED.map { k -> k to LinkStatsHistory.spread(snaps, k.ordinal, from, from + WINDOW_MS, HOURS) }
            Timeline(events, counts, from, from + WINDOW_MS)
        }
    }.value ?: return
    val c = Aioa.colors
    val pal = hxPalette()
    val tones = listOf(pal.chart2, c.danger, pal.chart3, pal.chart5, pal.chart4)
    Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("近 24 小时事件", c.text, 13, weight = FontWeight.Medium)
        Lane.entries.forEachIndexed { i, lane ->
            val ticks = data.events.filter { it.second == lane }.map { it.first }
            TrackRow(lane.label, ticks.size) { EventTrack(ticks, data.from, data.to, tones[i], Modifier.weight(1f).height(LANE_H)) }
        }
        Axis()
        val shown = data.counts.filter { it.second.any { n -> n > 0 } }
        Text("计数按小时 (快照之差)", c.text, 13, Modifier.padding(top = 6.dp), weight = FontWeight.Medium)
        if (shown.isEmpty()) Text("还没有快照: 后台服务每次看门狗唤醒时记一次, 至少隔 10 分钟", c.textSecondary, 12, maxLines = 2)
        shown.forEach { (k, arr) -> TrackRow(k.label, arr.sum()) { HourStrip(arr, pal.chart2, Modifier.weight(1f).height(LANE_H)) } }
        if (shown.isNotEmpty()) Axis()
    }
}

@Composable
private fun TrackRow(label: String, total: Int, track: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit) {
    val c = Aioa.colors
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, c.textSecondary, 11, Modifier.width(72.dp))
        track()
        Text("$total", c.text, 11, Modifier.width(32.dp))
    }
}

@Composable
private fun Axis() {
    val c = Aioa.colors
    Row(Modifier.fillMaxWidth().padding(start = 80.dp, end = 40.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        listOf("24 小时前", "12 小时前", "现在").forEach { Text(it, c.textSecondary, 10) }
    }
}

/** 一道事件: 每条一根细刻度, 底下一条淡轨。 */
@Composable
private fun EventTrack(ticks: List<Long>, from: Long, to: Long, tone: Color, modifier: Modifier) {
    val track = Aioa.colors.surfaceAlt
    Canvas(modifier) {
        drawRoundRect(track, Offset(0f, size.height * 0.3f), Size(size.width, size.height * 0.4f), CornerRadius(size.height))
        ticks.forEach { at ->
            val x = (at - from).toFloat() / (to - from) * size.width
            drawRect(tone.copy(alpha = 0.85f), Offset(x - 1f, 0f), Size(2.dp.toPx(), size.height))
        }
    }
}

/** 一行 24 格, 颜色深浅按这一行里最多的那小时。 */
@Composable
private fun HourStrip(values: IntArray, tone: Color, modifier: Modifier) {
    val empty = Aioa.colors.surfaceAlt
    val mx = (values.maxOrNull() ?: 0).coerceAtLeast(1)
    Canvas(modifier) {
        val slot = size.width / values.size
        values.forEachIndexed { i, v ->
            val color = if (v == 0) empty else tone.copy(alpha = 0.25f + 0.75f * v / mx)
            drawRoundRect(color, Offset(i * slot + 1f, 0f), Size(slot - 2f, size.height), CornerRadius(3.dp.toPx()))
        }
    }
}
