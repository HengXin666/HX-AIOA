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
import com.hengxin.aioa.kit.AdaptiveGrid
import com.hengxin.aioa.kit.Card
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

/** 画廊里的页面, 每个页面是一组用 mock 数据驱动的组件。 */
enum class Page(val title: String, val content: @Composable () -> Unit) {
    OVERVIEW("总览", { Overview() }),
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
    val cpu = rememberFeed(23f, 8f)
    val temp = rememberFeed(61f, 4f)
    Column(verticalArrangement = Arrangement.spacedBy(Aioa.metrics.gap)) {
        Text("总览", Aioa.colors.text, 26)
        Section("正在发生")
        AdaptiveGrid(Tile.entries, span = { if (it == Tile.TEMP) Int.MAX_VALUE else 1 }) { tile ->
            when (tile) {
                Tile.CPU -> StatCard("cpu", "CPU", cpu.last(), "%", trend = cpu, delta = "4 核 · NAS-01", source = "Beszel")
                Tile.MEM -> StatCard("memory-stick", "内存", 61f, "%", delta = "9.8 / 16 GB", source = "Beszel")
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
        LineChart(temp.mapIndexed { i, v -> Point("-${(HISTORY - 1 - i) * 2}s", v) }, "°C", threshold = 65f)
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
    }
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
