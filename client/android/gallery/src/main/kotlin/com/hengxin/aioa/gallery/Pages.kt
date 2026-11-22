package com.hengxin.aioa.gallery

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Card
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import com.hengxin.aioa.kit.AdaptiveGrid
import com.hengxin.aioa.kit.CardHeader
import com.hengxin.aioa.kit.CardState
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.Icons
import com.hengxin.aioa.kit.LineChart
import com.hengxin.aioa.kit.Point
import com.hengxin.aioa.kit.StatCard
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.fmt
import kotlinx.coroutines.delay
import kotlin.random.Random

private const val TICK_MS = 2000L
private const val HISTORY = 24
private const val TICK_SECONDS = (TICK_MS / 1000).toInt()

/** 画廊里的页面, 每个页面是一组用 mock 数据驱动的组件。 */
enum class Page(val title: String, val content: @Composable () -> Unit) {
    OVERVIEW("总览", { Overview() }),
    FEED("三层总览", { FeedOverview() }),
    AGENT("Agent", { AgentStates() }),
    STATES("状态", { States() }),
    ICONS("图标", { IconGrid() }),
}

/** 模拟定时推送: 每 2 秒来一个新数据点, 看得到刷新动画。 */
@Composable
private fun rememberFeed(start: Float, jitter: Float): List<Float> {
    var series by remember { mutableStateOf(List(HISTORY) { start + Random.nextFloat() * jitter - jitter / 2 }) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(TICK_MS)
            val next = (series.last() + Random.nextFloat() * jitter - jitter / 2).coerceAtLeast(0f)
            series = series.drop(1) + next
        }
    }
    return series
}

@Composable
private fun Section(title: String) {
    Spacer(Modifier.height(4.dp))
    Text(title, Aioa.colors.text, 15)
}

@Composable
private fun Overview() {
    val live = rememberLive()
    val mockCpu = rememberFeed(23f, 8f)
    val mockTemp = rememberFeed(61f, 4f)
    val liveCpu = live?.series("cpu").orEmpty()
    val cpu = if (liveCpu.size > 1) liveCpu else mockCpu
    val mem = live?.last("mem") ?: 61f
    val temp = live?.series("temp")?.takeIf { it.size > 1 } ?: mockTemp
    val host = live?.subject?.uppercase() ?: "NAS-01"
    val src = if (live != null) "探针" else "Beszel"
    Column(verticalArrangement = Arrangement.spacedBy(Aioa.metrics.gap)) {
        Text("总览", Aioa.colors.text, 26)
        Section("正在发生")
        AdaptiveGrid(Tile.entries, span = { if (it == Tile.TEMP) Int.MAX_VALUE else 1 }) { tile ->
            when (tile) {
                Tile.CPU -> StatCard("cpu", "CPU", cpu.last(), "%", trend = cpu, delta = host, source = src)
                Tile.MEM -> StatCard("memory-stick", "内存", mem, "%", delta = host, source = src)
                Tile.TEMP -> TempCard(temp)
                Tile.DISK -> StatCard("hard-drive", "存储", 72f, "%", delta = "5.8 / 8 TB", source = "Beszel")
                Tile.NET -> StatCard("activity", "今日消息", 18f, "条", delta = "比昨天 +3", source = "HX-AIOA")
            }
        }
        Section("需要我")
        StatCard("hard-drive", "NAS-01 磁盘剩余", 4.2f, "GB", delta = "低于 5 GB 告警线", source = "Beszel")
    }
}

private enum class Tile { CPU, MEM, DISK, NET, TEMP }

@Composable
private fun TempCard(temp: List<Float>) {
    Card {
        CardHeader("thermometer", "GPU 温度 · 过去 48 秒", "Beszel")
        Row(verticalAlignment = Alignment.Bottom) {
            Text(fmt(temp.last()), Aioa.colors.text, 30)
            Spacer(Modifier.width(3.dp))
            Text("°C", Aioa.colors.textSecondary, 14)
        }
        LineChart(timeline(temp), "°C", threshold = 65f)
    }
}

@Composable
private fun States() {
    Column(verticalArrangement = Arrangement.spacedBy(Aioa.metrics.gap)) {
        Text("四种状态", Aioa.colors.text, 26)
        StatCard("cpu", "加载中", 0f, "%", state = CardState.Loading)
        StatCard("server", "空", 0f, "", state = CardState.Empty)
        StatCard("wifi-off", "错误", 0f, "", state = CardState.Error("GPU-01 无法连接"))
        StatCard("thermometer", "过期", 58f, "°C", state = CardState.Stale("10 分钟前"))
        Text("悬停 / 按住", Aioa.colors.text, 18)
        Card { LineChart(timeline(List(HISTORY) { 60f + (it % 5) * 0.8f }), "°C", pinned = HISTORY / 2) }
    }
}

private val CLOCK = DateTimeFormatter.ofPattern("HH:mm:ss")

/** 给每个点配上真实时刻, 间隔与模拟数据刷新一致。 */
private fun timeline(values: List<Float>): List<Point> {
    val now = LocalTime.now()
    return values.mapIndexed { i, v -> Point(now.minusSeconds(((values.size - 1 - i) * TICK_SECONDS).toLong()).format(CLOCK), v) }
}

@Composable
private fun IconGrid() {
    val c = Aioa.colors
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("图标 (Lucide)", c.text, 26)
        Icons.names.sorted().chunked(4).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                row.forEach { name ->
                    Column(Modifier.width(76.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(name, c.text, 24.dp)
                        Text(name, c.textSecondary, 10)
                    }
                }
            }
        }
    }
}
