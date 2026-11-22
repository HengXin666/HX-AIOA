package com.hengxin.aioa.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.Constants
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Card
import com.hengxin.aioa.kit.CardHeader
import com.hengxin.aioa.kit.Dot
import com.hengxin.aioa.kit.LineChart
import com.hengxin.aioa.kit.Point
import com.hengxin.aioa.kit.ProgressBar
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.proto.HostCard
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.roundToInt

private const val FIELD_CPU = "cpu"
private const val FIELD_MEM = "mem"
private const val FIELD_DISK = "disk"
private const val FIELD_LOAD = "load"
private const val FIELD_RX = "rx"
private const val FIELD_TX = "tx"
private const val KIB = 1024.0
private const val UNITS = "KMGT"
private const val MINUTE_MS = 60_000L
private const val HOUR_MIN = 60L
private const val DAY_MIN = 1440L
private const val PCT = 100.0
private const val OFFLINE_ALPHA = 0.55f
private const val CPU_LINE_ALERT = 90f
private const val DASH = "-"

/** 主机卡片: 名称, IP, 系统, CPU / 内存 / 磁盘 用量, 网速, 负载, 在线率。有人在看时用实时点, 否则用 10 分钟快照。 */
@Composable
fun HostPanel(state: MetricsState, host: HostCard) {
    val c = Aioa.colors
    val live = if (host.online) state.samples[host.subject]?.lastOrNull() else null
    val v = host.last?.values.orEmpty() + live?.values.orEmpty()
    Card(Modifier.alpha(if (host.online) 1f else OFFLINE_ALPHA)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Dot(if (host.online) c.success else c.textSecondary)
            Spacer(Modifier.width(8.dp))
            Text(host.subject, c.text, 16, Modifier.weight(1f), FontWeight.SemiBold)
            Text(status(host, live != null), c.textSecondary, 12)
        }
        val meta = listOfNotNull(host.ip, host.os, host.cores?.let { "$it 核" }, host.arch).joinToString(" · ")
        if (meta.isNotEmpty()) Text(meta, c.textSecondary, 12)
        Meter("CPU", v[FIELD_CPU], v[FIELD_CPU]?.let { "${one(it)}%" } ?: DASH)
        Meter("内存", v[FIELD_MEM], used(v[FIELD_MEM], host.memTotal))
        Meter("磁盘", v[FIELD_DISK], used(v[FIELD_DISK], host.diskTotal))
        Row(Modifier.fillMaxWidth()) {
            Text("网速 ↓${rate(v[FIELD_RX])} ↑${rate(v[FIELD_TX])}", c.textSecondary, 12, Modifier.weight(1f))
            Text("负载 ${v[FIELD_LOAD]?.let(::one) ?: DASH}", c.textSecondary, 12)
        }
        Row(Modifier.fillMaxWidth()) {
            Text("在线率 ${host.avail?.let { "${one(it)}%" } ?: DASH} (24h)", c.textSecondary, 12, Modifier.weight(1f))
            host.bootAt?.takeIf { host.online }?.let { Text("已运行 ${uptime(it)}", c.textSecondary, 12) }
        }
    }
    val cpu = state.series(host.subject, FIELD_CPU)
    if (host.online && cpu.size > 1) {
        Card {
            CardHeader(Constants.ICON_ACTIVITY, "${host.subject} CPU 走势", SOURCE_PROBE)
            LineChart(cpu.map { (ts, value) -> Point(clock(ts), value) }, PERCENT, threshold = CPU_LINE_ALERT)
        }
    }
}

@Composable
private fun Meter(label: String, pct: Double?, detail: String) {
    val c = Aioa.colors
    Column {
        Row(Modifier.fillMaxWidth()) {
            Text(label, c.text, 13, Modifier.weight(1f))
            Text(detail, c.textSecondary, 12)
        }
        ProgressBar(((pct ?: 0.0) / PCT).toFloat())
    }
}

private fun status(h: HostCard, live: Boolean): String = when {
    !h.online -> "离线 · ${stamp(h.seen)}"
    live -> "实时"
    else -> "快照 ${stamp(h.seen)}"
}

private fun stamp(ms: Long) = SimpleDateFormat("MM-dd HH:mm", Locale.CHINA).format(Date(ms))

private fun one(v: Double) = if (v >= PCT) v.roundToInt().toString() else "%.1f".format(Locale.US, v)

private fun used(pct: Double?, total: Double?): String = when {
    pct == null -> DASH
    total == null -> "${one(pct)}%"
    else -> "${one(pct)}% · ${size(total * pct / PCT)} / ${size(total)}"
}

/** 字节数换成可读大小。 */
private fun size(bytes: Double): String {
    var v = bytes
    var unit = "B"
    for (u in UNITS) {
        if (v < KIB) break
        v /= KIB
        unit = "${u}B"
    }
    return "${one(v)} $unit"
}

private fun rate(kbps: Double?): String = kbps?.let { size(it * KIB) + "/s" } ?: DASH

private fun uptime(bootAt: Long): String {
    val min = (System.currentTimeMillis() - bootAt) / MINUTE_MS
    return when {
        min >= DAY_MIN -> "${min / DAY_MIN} 天 ${min % DAY_MIN / HOUR_MIN} 小时"
        min >= HOUR_MIN -> "${min / HOUR_MIN} 小时 ${min % HOUR_MIN} 分"
        else -> "$min 分"
    }
}
