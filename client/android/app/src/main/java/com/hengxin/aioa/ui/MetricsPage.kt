package com.hengxin.aioa.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.hengxin.aioa.ui.settings.CfUsageCard
import com.hengxin.aioa.ui.term.AddHostDialog
import com.hengxin.aioa.ui.term.ShellPasswordDialog
import com.hengxin.aioa.ui.term.TerminalDialog
import com.hengxin.aioa.Constants
import com.hengxin.aioa.kit.AdaptiveGrid
import com.hengxin.aioa.kit.Card
import com.hengxin.aioa.kit.CardHeader
import com.hengxin.aioa.kit.CardState
import com.hengxin.aioa.kit.LineChart
import com.hengxin.aioa.kit.Point
import com.hengxin.aioa.kit.SettingRow
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

/** 资源页: 上方是 Agent 下发的工作台, 下方是在线探针; 可见时 watch 两者用到的主体, 离开即取消, 服务端随之让探针停推。 */
@Composable
fun MetricsPage(chat: ChatModel, openGithub: () -> Unit) {
    val state = chat.metrics
    val spaces = chat.spaces
    val current = spaces.spaces.firstOrNull { it.id == spaces.currentId } ?: spaces.spaces.firstOrNull()
    WatchProbes(state, current?.metricSubjects().orEmpty())
    var adding by remember { mutableStateOf(false) }
    var askFor by remember { mutableStateOf<String?>(null) }
    var session by remember { mutableStateOf<Pair<String, String>?>(null) }
    if (adding) AddHostDialog { adding = false }
    askFor?.let { s ->
        ShellPasswordDialog(s, { askFor = null }) { ticket ->
            askFor = null
            session = s to ticket
        }
    }
    session?.let { (s, ticket) -> TerminalDialog(chat.terms, s, ticket) { session = null } }
    PageColumn(Tab.RESOURCES.label) {
        if (chat.github.enabled) Card { SettingRow(ICON_GITHUB, GITHUB_TITLE, chat.github.repos.size.takeIf { it > 0 }?.let { "$it 个仓库" }.orEmpty(), openGithub) }
        CfUsageCard()
        val carded = state.hosts.map { it.subject }.toSet()
        Card { SettingRow("server", "添加主机", "一行命令安装探针", { adding = true }) }
        // 主机一行一台, 点开才显示详细面板 (#138)
        var openHost by androidx.compose.runtime.saveable.rememberSaveable { mutableStateOf<String?>(null) }
        HostLines(state, openHost) { s -> openHost = if (openHost == s) null else s }
        state.hosts.firstOrNull { it.subject == openHost }?.let { h -> HostPanel(state, h) { askFor = h.subject } }
        // 旧版探针不发主机卡片, 仍用原来的指标格子
        state.probes.filter { it !in carded }.forEach { Probe(state, it) }
        // hxoa 插件 (hengxin666.hxoa) 往 "服务器" 加的分组 (home-spaces §3), 没启用不显示 (#142)
        com.hengxin.aioa.ui.hxoa.HxoaSection()
    }
}

/** 页面可见期间声明在看全部在线探针, 以及当前工作台绑定的主体。 */
@Composable
fun WatchProbes(state: MetricsState, extra: Set<String> = emptySet()) {
    val subjects = (state.probes + extra).distinct()
    DisposableEffect(subjects) {
        state.watch(subjects)
        onDispose { state.watch(emptyList()) }
    }
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
            CardHeader(Constants.ICON_ACTIVITY, "CPU 走势", SOURCE_PROBE)
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
