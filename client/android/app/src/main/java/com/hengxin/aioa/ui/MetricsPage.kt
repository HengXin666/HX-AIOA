package com.hengxin.aioa.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import com.hengxin.aioa.kit.AdaptiveGrid
import com.hengxin.aioa.kit.Card
import com.hengxin.aioa.kit.CardHeader
import com.hengxin.aioa.kit.CardState
import com.hengxin.aioa.kit.LineChart
import com.hengxin.aioa.kit.Point
import com.hengxin.aioa.kit.StatCard
import com.hengxin.aioa.kit.Text
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

const val SOURCE_PROBE = "探针"
const val KEY_CPU = "cpu"
private const val KEY_MEM = "mem"
private const val KEY_LOAD = "load"
private const val KEY_TEMP = "temp"
const val PERCENT = "%"
private const val CPU_ALERT = 90f

private enum class MetricTile { CPU, MEM, LOAD, TEMP }

/** 资源页: 可见时 watch 所有在线探针, 离开 (切页, 进入后台断线) 即取消, 服务端随之让探针停推。 */
@Composable
fun MetricsPage(state: MetricsState) {
    WatchProbes(state)
    PageColumn("资源") {
        if (state.probes.isEmpty()) NoProbe()
        state.probes.forEach { Probe(state, it) }
    }
}

/** 页面可见期间声明在看全部在线探针。 */
@Composable
fun WatchProbes(state: MetricsState) {
    val probes = state.probes
    DisposableEffect(probes) {
        state.watch(probes)
        onDispose { state.watch(emptyList()) }
    }
}

@Composable
fun NoProbe() {
    StatCard("server", "探针", 0f, "", state = CardState.Error("没有在线探针, 在服务器上运行 tools/probe.mjs"))
}

@Composable
private fun Probe(state: MetricsState, subject: String) {
    val cpu = state.series(subject, KEY_CPU)
    val tiles = MetricTile.entries.filter { it != MetricTile.TEMP || state.series(subject, KEY_TEMP).isNotEmpty() }
    PageSection(subject)
    if (cpu.isEmpty()) {
        StatCard("cpu", "CPU", 0f, PERCENT, state = CardState.Loading, source = SOURCE_PROBE)
        return
    }
    AdaptiveGrid(tiles) { tile ->
        when (tile) {
            MetricTile.CPU -> Stat(state, subject, "cpu", "CPU", KEY_CPU, PERCENT)
            MetricTile.MEM -> Stat(state, subject, "memory-stick", "内存", KEY_MEM, PERCENT)
            MetricTile.LOAD -> Stat(state, subject, "gauge", "负载", KEY_LOAD, "")
            MetricTile.TEMP -> Stat(state, subject, "thermometer", "温度", KEY_TEMP, "°C")
        }
    }
    if (cpu.size > 1) {
        Card {
            CardHeader("activity", "CPU 走势", SOURCE_PROBE)
            LineChart(cpu.map { (ts, v) -> Point(clock(ts), v) }, PERCENT, threshold = CPU_ALERT)
        }
    }
}

@Composable
private fun Stat(state: MetricsState, subject: String, icon: String, title: String, key: String, unit: String) {
    val series = state.series(subject, key).map { it.second }
    StatCard(icon, title, series.lastOrNull() ?: 0f, unit, trend = series, source = SOURCE_PROBE)
}

fun clock(ts: Long): String = SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(Date(ts))
