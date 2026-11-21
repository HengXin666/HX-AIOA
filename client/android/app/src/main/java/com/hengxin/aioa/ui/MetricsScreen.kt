package com.hengxin.aioa.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Adaptive
import com.hengxin.aioa.kit.AdaptiveGrid
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.AioaTheme
import com.hengxin.aioa.kit.Appearance
import com.hengxin.aioa.kit.Card
import com.hengxin.aioa.kit.CardHeader
import com.hengxin.aioa.kit.CardState
import com.hengxin.aioa.kit.LineChart
import com.hengxin.aioa.kit.Point
import com.hengxin.aioa.kit.StatCard
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.pressable
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private const val SOURCE = "探针"
private const val KEY_CPU = "cpu"
private const val KEY_MEM = "mem"
private const val KEY_LOAD = "load"
private const val KEY_TEMP = "temp"
private const val PERCENT = "%"
private const val MAX_CONTENT_DP = 1040
private const val CPU_ALERT = 90f

private enum class Tile { CPU, MEM, LOAD, TEMP }

/** 资源页: 可见时 watch 所有在线探针, 离开 (含返回, 进入后台断线) 即取消, 服务端随之让探针停推。 */
@Composable
fun MetricsScreen(state: MetricsState, onBack: () -> Unit) {
    BackHandler(onBack = onBack)
    val probes = state.probes
    DisposableEffect(probes) {
        state.watch(probes)
        onDispose { state.watch(emptyList()) }
    }
    AioaTheme(Appearance(dark = isSystemInDarkTheme())) {
        val c = Aioa.colors
        Adaptive(Modifier.fillMaxSize().background(c.background).safeDrawingPadding()) {
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Column(Modifier.widthIn(max = MAX_CONTENT_DP.dp), verticalArrangement = Arrangement.spacedBy(Aioa.metrics.gap)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("‹ 返回", c.textSecondary, 15, Modifier.pressable(onBack).padding(end = 16.dp))
                        Text("资源", c.text, 26)
                    }
                    if (probes.isEmpty()) {
                        StatCard("server", "探针", 0f, "", state = CardState.Error("没有在线探针, 在服务器上运行 tools/probe.mjs"))
                    }
                    probes.forEach { Probe(state, it) }
                }
            }
        }
    }
}

@Composable
private fun Probe(state: MetricsState, subject: String) {
    val c = Aioa.colors
    val cpu = state.series(subject, KEY_CPU)
    val tiles = Tile.entries.filter { it != Tile.TEMP || state.series(subject, KEY_TEMP).isNotEmpty() }
    Spacer(Modifier.height(4.dp))
    Text(subject, c.text, 15)
    if (cpu.isEmpty()) {
        StatCard("cpu", "CPU", 0f, PERCENT, state = CardState.Loading, source = SOURCE)
        return
    }
    AdaptiveGrid(tiles) { tile ->
        when (tile) {
            Tile.CPU -> Stat(state, subject, "cpu", "CPU", KEY_CPU, PERCENT)
            Tile.MEM -> Stat(state, subject, "memory-stick", "内存", KEY_MEM, PERCENT)
            Tile.LOAD -> Stat(state, subject, "gauge", "负载", KEY_LOAD, "")
            Tile.TEMP -> Stat(state, subject, "thermometer", "温度", KEY_TEMP, "°C")
        }
    }
    if (cpu.size > 1) {
        Card {
            CardHeader("activity", "CPU 走势", SOURCE)
            LineChart(cpu.map { (ts, v) -> Point(clock(ts), v) }, PERCENT, threshold = CPU_ALERT)
        }
    }
}

@Composable
private fun Stat(state: MetricsState, subject: String, icon: String, title: String, key: String, unit: String) {
    val series = state.series(subject, key).map { it.second }
    StatCard(icon, title, series.lastOrNull() ?: 0f, unit, trend = series, source = SOURCE)
}

private fun clock(ts: Long): String = SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(Date(ts))
