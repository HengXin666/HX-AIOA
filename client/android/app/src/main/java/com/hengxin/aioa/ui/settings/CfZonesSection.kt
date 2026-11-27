package com.hengxin.aioa.ui.settings

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Chip
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.net.Api
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

// CF 总览: 按根域名看流量, 展开看域名下的服务; Worker 单独一组。数据服务端缓存 5 分钟。
private const val PATH = "api/v1/cf/zones"
private const val RANGE_DAY = "1d"
private const val RANGE_WEEK = "7d"
private const val HOSTS_SHOWN = 12
private const val US_PER_MS = 1000.0
private const val ORIGIN = "源站"
private const val PCT_SCALE = 100f
// 单个站点占到每日额度的这个比例就标红
private const val QUOTA_WARN = 0.5f
private val STATUS_ORDER = listOf("2xx", "3xx", "4xx", "5xx")
private val BAR_SHAPE = RoundedCornerShape(3.dp)

private class Point(val req: Long, val cached: Long, val threats: Long)
private class Host(val host: String, val req: Long, val err: Long, val bytes: Long, val service: String?)
private class Zone(
    val name: String, val req: Long, val cached: Long, val bytes: Long, val threats: Long,
    val status: Map<String, Long>, val countries: List<Pair<String, Long>>, val series: List<Point>, val hosts: List<Host>,
    // 近 24 小时落到 Worker 的请求; 服务端没有主机名数据时为 null
    val workerReq: Long?,
)
private class Worker(val name: String, val req: Long, val err: Long, val cpuP50: Double, val cpuP99: Double, val hosts: List<String>)

private fun JSONArray?.objs(): List<JSONObject> = this?.let { a -> (0 until a.length()).mapNotNull { a.optJSONObject(it) } }.orEmpty()

// 同一主机带端口 (aioa.x:443) 的并进主机名
private fun hosts(a: JSONArray?): List<Host> = a.objs()
    .groupBy { it.optString("host").substringBefore(':') }
    .map { (h, rows) ->
        val svc = rows.firstNotNullOfOrNull { r -> r.optJSONObject("service")?.let { (if (it.optString("kind") == "pages") "Pages " else "Worker ") + it.optString("name") } }
        Host(h, rows.sumOf { it.optLong("req") }, rows.sumOf { it.optLong("err") }, rows.sumOf { it.optLong("bytes") }, svc)
    }
    .sortedByDescending { it.req }

private fun zone(o: JSONObject) = Zone(
    o.optString("name"), o.optLong("req"), o.optLong("cached"), o.optLong("bytes"), o.optLong("threats"),
    o.optJSONObject("status")?.let { s -> s.keys().asSequence().associateWith { s.optLong(it) } }.orEmpty(),
    o.optJSONArray("countries").objs().map { it.optString("name") to it.optLong("req") },
    o.optJSONArray("series").objs().map { Point(it.optLong("req"), it.optLong("cached"), it.optLong("threats")) },
    hosts(o.optJSONArray("hosts")),
    if (o.has("workerReq")) o.optLong("workerReq") else null,
)

private fun worker(o: JSONObject) = Worker(
    o.optString("name"), o.optLong("req"), o.optLong("err"), o.optDouble("cpuP50", 0.0), o.optDouble("cpuP99", 0.0),
    o.optJSONArray("hosts")?.let { a -> (0 until a.length()).map { a.optString(it) } }.orEmpty(),
)

private fun count(v: Long): String = when {
    v >= 1_000_000 -> String.format(Locale.US, "%.1fM", v / 1e6)
    v >= 10_000 -> String.format(Locale.US, "%.1fk", v / 1e3)
    else -> String.format(Locale.US, "%,d", v)
}

private fun size(v: Long): String {
    val units = listOf("B", "KB", "MB", "GB", "TB")
    var x = v.toDouble()
    var i = 0
    while (x >= 1024 && i < units.lastIndex) { x /= 1024; i++ }
    return if (i == 0) "$v B" else String.format(Locale.US, "%.1f %s", x, units[i])
}

private fun pct(part: Long, all: Long) = if (all > 0) "${part * 100 / all}%" else "-"

@Composable
private fun statusColor(k: String): Color {
    val c = Aioa.colors
    return when (k) {
        "2xx" -> c.success
        "3xx" -> c.accent
        "4xx" -> c.warning
        "5xx" -> c.danger
        else -> c.border
    }
}

/** CF 页里的总览部分: 时间切换, 全账号四个数, 各根域名卡片, Worker 列表。 */
@Composable
fun CfZonesSection() {
    var range by rememberSaveable { mutableStateOf(RANGE_DAY) }
    // 每个时间范围各存一份: 切换时直接显示上次的, 不闪 "加载中"
    val data = rememberCached("cf-zones-$range", PATH, mapOf("range" to range))
    val body = data.body
    val error = if (body == null) data.error else ""
    val c = Aioa.colors
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Chip("24 小时", range == RANGE_DAY) { range = RANGE_DAY }
        Chip("7 天", range == RANGE_WEEK) { range = RANGE_WEEK }
    }
    val b = body
    when {
        error.isNotEmpty() -> SettingsGroup { NoteRow(error, c.danger) }
        b == null -> SettingsGroup { NoteRow("加载中...") }
        !b.optBoolean("configured") -> Unit
        else -> {
            val zones = b.optJSONArray("zones").objs().map(::zone)
            val workers = b.optJSONArray("workers").objs().map(::worker)
            if (data.stale) SettingsGroup { NoteRow("刷新失败, 显示的是上次的数据: ${data.error}", c.warning) }
            Totals(zones)
            val limit = b.optLong("workerDayLimit")
            zones.filter { it.req > 0 }.forEach { ZoneCard(it, range, limit) }
            val idle = zones.filter { it.req == 0L }.joinToString(", ") { it.name }
            if (idle.isNotEmpty()) SettingsGroup { NoteRow("没有流量: $idle") }
            if (workers.isNotEmpty()) WorkerGroup(workers)
            val noSvc = zones.all { z -> z.hosts.all { it.service == null } }
            if (noSvc) SettingsGroup(footer = "给 CF token 加上 账户 · Workers 脚本 · 读取 和 账户 · Cloudflare Pages · 读取, 域名后面就会标出挂的是哪个服务。") {
                NoteRow("还看不到域名对应的服务", c.textSecondary)
            }
        }
    }
}

@Composable
private fun Totals(zones: List<Zone>) {
    val req = zones.sumOf { it.req }
    val items = listOf(
        "请求" to count(req),
        "流量" to size(zones.sumOf { it.bytes }),
        "缓存命中" to pct(zones.sumOf { it.cached }, req),
        "拦截威胁" to count(zones.sumOf { it.threats }),
    )
    SettingsGroup("全部域名") {
        Row(Modifier.fillMaxWidth().padding(vertical = 12.dp)) {
            items.forEach { (k, v) ->
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(v, Aioa.colors.text, 17, weight = FontWeight.SemiBold)
                    Text(k, Aioa.colors.textSecondary, 12)
                }
            }
        }
    }
}

@Composable
private fun ZoneCard(z: Zone, range: String, workerLimit: Long) {
    val c = Aioa.colors
    var open by remember { mutableStateOf(false) }
    SettingsGroup(z.name) {
        Column(Modifier.fillMaxWidth().clickable { open = !open }.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.Bottom) {
                Text(count(z.req), c.text, 20, weight = FontWeight.SemiBold)
                Text("  请求 · ${size(z.bytes)} · 缓存 ${pct(z.cached, z.req)} · 威胁 ${count(z.threats)}", c.textSecondary, 12)
            }
            if (z.workerReq != null && z.workerReq > 0 && workerLimit > 0) {
                val share = z.workerReq.toFloat() / workerLimit
                Text("Worker 请求占每日额度 ${String.format(Locale.US, "%.1f", share * PCT_SCALE)}% (近 24 小时 ${count(z.workerReq)} 次)", if (share >= QUOTA_WARN) c.danger else c.textSecondary, 12)
            }
            TrafficChart(z.series)
            Text(if (range == RANGE_DAY) "每小时请求, 浅色为缓存命中" else "每天请求, 浅色为缓存命中", c.textSecondary, 11)
            StatusBar(z.status)
            Text(if (open) "收起" else "展开看服务 (${z.hosts.size} 个主机名)", c.accent, 13)
        }
        if (open) {
            RowDivider(indent = false)
            HostList(z.hosts)
            if (z.countries.isNotEmpty()) {
                RowDivider(indent = false)
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("来源国家/地区", c.textSecondary, 12)
                    val top = z.countries.first().second.coerceAtLeast(1)
                    z.countries.forEach { (name, n) -> BarRow(name, n.toFloat() / top, count(n), c.accent) }
                }
            }
        }
    }
}

/** 柱状图: 每根柱子是一个时段, 深色总请求, 浅色其中的缓存命中。 */
@Composable
private fun TrafficChart(series: List<Point>) {
    val c = Aioa.colors
    val max = (series.maxOfOrNull { it.req } ?: 0L).coerceAtLeast(1L).toFloat()
    val main = c.accent
    val light = c.accent.copy(alpha = 0.35f)
    Canvas(Modifier.fillMaxWidth().height(72.dp)) {
        if (series.isEmpty()) return@Canvas
        val slot = size.width / series.size
        val w = (slot * 0.7f).coerceAtLeast(1f)
        val r = CornerRadius(w / 4, w / 4)
        series.forEachIndexed { i, p ->
            val x = i * slot + (slot - w) / 2
            val h = size.height * p.req / max
            drawRoundRect(main, Offset(x, size.height - h), Size(w, h.coerceAtLeast(1f)), r)
            val ch = size.height * p.cached / max
            if (ch > 0) drawRoundRect(light, Offset(x, size.height - ch), Size(w, ch), r)
        }
    }
}

/** 状态码占比: 一条分段条 + 图例。 */
@Composable
private fun StatusBar(status: Map<String, Long>) {
    val c = Aioa.colors
    val all = status.values.sum().coerceAtLeast(1)
    val keys = STATUS_ORDER + status.keys.filter { it !in STATUS_ORDER }
    Row(Modifier.fillMaxWidth().height(8.dp).clip(BAR_SHAPE)) {
        keys.forEach { k ->
            val n = status[k] ?: 0
            if (n > 0) Box(Modifier.weight(n.toFloat()).fillMaxHeight().background(statusColor(k)))
        }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        keys.forEach { k ->
            val n = status[k] ?: 0
            if (n > 0) Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.width(8.dp).height(8.dp).clip(BAR_SHAPE).background(statusColor(k)))
                Text(" $k ${n * 100 / all}%", c.textSecondary, 11)
            }
        }
    }
}

/** 一行一条 (#138): 名字, 小字说明, 数值, 最右一根短条 (占最大值的比例)。 */
@Composable
private fun BarRow(label: String, ratio: Float, value: String, color: Color, sub: String? = null, subColor: Color? = null) {
    val c = Aioa.colors
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, c.text, 13, Modifier.weight(1f))
        if (sub != null) Text(sub, subColor ?: c.textSecondary, 11, Modifier.widthIn(max = SUB_MAX))
        Text(value, c.textSecondary, 12)
        Box(Modifier.width(BAR_W).height(4.dp).clip(BAR_SHAPE).background(c.surfaceAlt)) {
            Box(Modifier.fillMaxWidth(ratio.coerceIn(0.01f, 1f)).fillMaxHeight().background(color))
        }
    }
}

private val BAR_W = 48.dp
private val SUB_MAX = 140.dp

/** 主机名排行: 条长是请求数, 标出挂的服务, 5xx 多的标红。 */
@Composable
private fun HostList(hosts: List<Host>) {
    val c = Aioa.colors
    var all by remember { mutableStateOf(false) }
    val top = (hosts.firstOrNull()?.req ?: 0L).coerceAtLeast(1L)
    // 能读到服务列表时, 没对上 Worker/Pages 的就是代理到源站 (隧道/服务器)
    val known = hosts.any { it.service != null }
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("主机名 (近 24 小时)", c.textSecondary, 12)
        (if (all) hosts else hosts.take(HOSTS_SHOWN)).forEach { h ->
            val bad = h.req > 0 && h.err * 10 >= h.req
            val sub = listOfNotNull(h.service ?: if (known) ORIGIN else null, if (h.err > 0) "5xx ${pct(h.err, h.req)}" else null).joinToString(" · ").ifEmpty { null }
            BarRow(h.host, h.req.toFloat() / top, count(h.req), if (bad) c.danger else c.accent, sub, if (bad) c.danger else null)
        }
        if (hosts.size > HOSTS_SHOWN) Text(if (all) "收起" else "显示全部 ${hosts.size} 个", c.accent, 13, Modifier.clickable { all = !all })
    }
}

/** Worker: 请求条 + 错误率 + CPU 中位/P99 (毫秒)。 */
@Composable
private fun WorkerGroup(workers: List<Worker>) {
    val c = Aioa.colors
    val top = (workers.maxOfOrNull { it.req } ?: 0L).coerceAtLeast(1L)
    SettingsGroup("Worker", footer = "CPU 为单次请求的 CPU 时间, 中位 / P99。免费计划单次上限 10 ms。") {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            workers.forEach { w ->
                val sub = buildString {
                    append(String.format(Locale.US, "CPU %.1f / %.1f ms", w.cpuP50 / US_PER_MS, w.cpuP99 / US_PER_MS))
                    if (w.err > 0) append(" · 错误 ${pct(w.err, w.req)}")
                    if (w.hosts.isNotEmpty()) append(" · ${w.hosts.size} 个域名")
                }
                BarRow(w.name, w.req.toFloat() / top, count(w.req), if (w.err > 0) c.danger else c.accent, sub, if (w.err > 0) c.danger else null)
            }
        }
    }
}
