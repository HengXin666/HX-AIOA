package com.hengxin.aioa.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.hengxin.aioa.kit.Card
import com.hengxin.aioa.kit.CardHeader
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import com.hengxin.aioa.kit.Dot
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.ProgressBar
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.net.Api
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private const val PATH = "api/v1/cf/usage"
private const val WARN = 0.8f
private const val PCT = 100

private class Part(val name: String, val used: Long)

private class Usage(val label: String, val used: Long, val limit: Long, val unit: String, val by: List<Part> = emptyList()) {
    val ratio get() = if (limit > 0) used.toFloat() / limit else 0f
}

private fun parse(o: JSONObject): List<Usage> {
    val arr = o.optJSONArray("items") ?: return emptyList()
    return (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }
        .map { o ->
            val by = o.optJSONArray("by")?.let { a -> (0 until a.length()).mapNotNull { a.optJSONObject(it) }.map { Part(it.optString("name"), it.optLong("used")) } }
            Usage(o.optString("label"), o.optLong("used"), o.optLong("limit"), o.optString("unit"), by.orEmpty())
        }
}

/** 各 worker 的颜色: 按今天各项占比之和排序, 前几名各一色, 其余归 "其他"。 */
private fun workersOf(items: List<Usage>): List<String> =
    items.flatMap { u -> u.by.map { it.name to (if (u.limit > 0) it.used.toFloat() / u.limit else 0f) } }
        .groupBy({ it.first }, { it.second }).mapValues { it.value.sum() }
        .entries.sortedByDescending { it.value }.map { it.key }.take(MAX_WORKERS)

private const val MAX_WORKERS = 4
private const val OTHER = "其他"

private fun num(v: Long) = String.format(Locale.US, "%,d", v)

/** 只能在协程里调用: 返回 (内容, 错误)。 */
private const val CACHE_NAME = "cf-usage"

private fun bytes(v: Long): String {
    var x = v.toDouble()
    var unit = "B"
    for (u in "KMGT") {
        if (x < KIB) break
        x /= KIB
        unit = "${u}B"
    }
    return String.format(Locale.US, "%.1f %s", x, unit)
}

private const val KIB = 1024.0

/** 资源页 / 服务器看板上的小卡片: 今天用得最多的一项; 点开是完整的额度与存储。非主账号看不到。 */
@Composable
fun CfUsageCard() {
    var open by remember { mutableStateOf(false) }
    // 重启 App 后也先显示上次的, 卡片不会晚一拍才冒出来
    val b = rememberCached(CACHE_NAME, PATH).body ?: return
    val c = Aioa.colors
    if (open) {
        Dialog({ open = false }, DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
            Box(Modifier.fillMaxSize().systemBarsPadding()) { CfUsagePage { open = false } }
        }
    }
    Card(onClick = { open = true }) {
        CardHeader("gauge", SettingsPage.CF_USAGE.title, "Cloudflare")
        if (!b.optBoolean("configured")) {
            Text("还没配置只读 token, 点开看怎么配", c.textSecondary, 13)
        } else {
            val top = parse(b).maxByOrNull { it.ratio }
            top?.let {
                Row(Modifier.fillMaxWidth()) {
                    Text("今天最高: ${it.label}", c.text, 13, Modifier.weight(1f))
                    Text("${(it.ratio * PCT).toInt()}%", if (it.ratio >= WARN) c.danger else c.textSecondary, 13)
                }
                ProgressBar(it.ratio.coerceIn(0f, 1f))
                it.by.firstOrNull()?.let { p -> Text("主要来自 ${p.name}", c.textSecondary, 12) }
            }
        }
    }
}

/** CF 额度: 今天 (UTC 0 点重置) 的免费额度用量, 服务端缓存 10 分钟; 任一项到 80% 会在 "CF 额度" 群提醒一次。 */
@Composable
fun CfUsagePage(onBack: (() -> Unit)?) {
    var reload by remember { mutableIntStateOf(0) }
    val data = rememberCached(CACHE_NAME, PATH, reload = reload)
    val body = data.body
    val error = if (body == null) data.error else ""
    val c = Aioa.colors
    SettingsPageFrame(SettingsPage.CF_USAGE.title, onBack) {
        val b = body
        when {
            error.isNotEmpty() -> SettingsGroup { NoteRow(error, c.danger) }
            b == null -> SettingsGroup { NoteRow("加载中...") }
            !b.optBoolean("configured") -> SettingsGroup("还没配置", footer = "token 只存在 Worker 的密钥里, 不会出现在 App 和聊天里。") {
                NoteRow("1. CF 控制台 → 我的个人资料 → API 令牌 → 创建令牌 → 自定义, 权限选 账户 · Account Analytics · 读取。")
                NoteRow("2. 存到仓库 secret: gh secret set CF_ANALYTICS_TOKEN")
                NoteRow("3. 运行一次服务端部署 (gh workflow run deploy.yml), 账号 id 会从已有的 CLOUDFLARE_ACCOUNT_ID 同步。")
            }
            else -> {
                val at = b.optLong("at").takeIf { it > 0 }?.let { SimpleDateFormat("HH:mm", Locale.CHINA).format(Date(it)) }.orEmpty()
                val items = parse(b)
                val workers = workersOf(items)
                val palette = listOf(c.accent, c.success, c.warning, c.danger)
                val colorOf = { name: String -> workers.indexOf(name).takeIf { it >= 0 }?.let { palette[it] } ?: c.textSecondary }
                val foot = "免费计划每天 UTC 0 点 (北京时间 8 点) 重置。条内按 worker 分色, 点一项看各 worker 的数字。" +
                    (b.optString("split").ifEmpty { null }?.let { " 拆分失败: $it" } ?: "")
                SettingsGroup("${b.optString("day")} (UTC) · 截至 $at", footer = foot) {
                    if (workers.isNotEmpty()) Legend(workers, colorOf)
                    items.forEachIndexed { i, u ->
                        if (i > 0 || workers.isNotEmpty()) RowDivider()
                        UsageRow(u, colorOf = colorOf)
                    }
                }
                b.optJSONObject("storage")?.let { s ->
                    SettingsGroup("存储", footer = "账号存储来自 CF 统计, 有延迟, 不按天重置; 主数据库大小是实时的。") {
                        if (s.has("storedBytes")) {
                            val used = s.optLong("storedBytes")
                            val limit = s.optLong("limit")
                            UsageRow(Usage("DO 存储 (整个账号)", used, limit, ""), "${bytes(used)} / ${bytes(limit)}")
                            RowDivider()
                        }
                        if (s.has("hubBytes")) InfoRow("主数据库 (实时)", bytes(s.optLong("hubBytes")))
                    }
                }
                CfStorageSection()
                CfZonesSection()
                SettingsGroup { ActionRow(TEXT_REFRESH, ICON_REFRESH) { reload++ } }
            }
        }
    }
}

@Composable
private fun Legend(workers: List<String>, colorOf: (String) -> Color) {
    val c = Aioa.colors
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        (workers + OTHER).forEach { w ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Dot(colorOf(w))
                Text(w, c.textSecondary, 12)
            }
        }
    }
}

/** 一项额度: 有拆分时条内按 worker 分段, 点开列出各 worker 的用量。 */
@Composable
private fun UsageRow(u: Usage, detail: String? = null, colorOf: ((String) -> Color)? = null) {
    val c = Aioa.colors
    var open by remember { mutableStateOf(false) }
    val split = colorOf != null && u.by.isNotEmpty()
    val mod = if (split) Modifier.clickable { open = !open } else Modifier
    Column(mod.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(Modifier.fillMaxWidth()) {
            Text(u.label, c.text, 14, Modifier.weight(1f))
            Text("${(u.ratio * PCT).toInt()}%", if (u.ratio >= WARN) c.danger else c.textSecondary, 13)
        }
        if (split) SegBar(u, colorOf!!) else ProgressBar(u.ratio.coerceIn(0f, 1f))
        Text(detail ?: "${num(u.used)} / ${num(u.limit)} ${u.unit}", c.textSecondary, 12)
        if (open) u.by.forEach { p ->
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Dot(colorOf!!(p.name))
                Text(p.name, c.text, 13, Modifier.weight(1f))
                Text("${num(p.used)} ${u.unit}", c.textSecondary, 12)
            }
        }
    }
}

/** 分段进度条: 每个 worker 一段, 宽度 = 它的用量 / 额度。 */
@Composable
private fun SegBar(u: Usage, colorOf: (String) -> Color) {
    val c = Aioa.colors
    val limit = u.limit.coerceAtLeast(1).toFloat()
    val parts = u.by.map { it to (it.used / limit) }
    val usedPart = parts.sumOf { it.second.toDouble() }.toFloat().coerceAtMost(1f)
    Row(Modifier.fillMaxWidth().height(BAR_H).clip(RoundedCornerShape(BAR_H / 2)).background(c.border)) {
        var left = 1f
        parts.forEach { (p, r) ->
            val w = r.coerceAtMost(left)
            if (w > 0f) Box(Modifier.weight(w).height(BAR_H).background(colorOf(p.name)))
            left -= w
        }
        if (1f - usedPart > 0f) Box(Modifier.weight(1f - usedPart).height(BAR_H))
    }
}

private val BAR_H = 6.dp
