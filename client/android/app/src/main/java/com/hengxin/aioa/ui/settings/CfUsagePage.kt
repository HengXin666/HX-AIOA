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
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.height
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

private class Usage(val label: String, val used: Long, val limit: Long, val unit: String, val by: List<Part> = emptyList()) {
    val ratio get() = if (limit > 0) used.toFloat() / limit else 0f
}

private fun parse(o: JSONObject): List<Usage> {
    val arr = o.optJSONArray("items") ?: return emptyList()
    return (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }
        .map { o ->
            Usage(o.optString("label"), o.optLong("used"), o.optLong("limit"), o.optString("unit"), partsOf(o))
        }
}

private fun num(v: Long) = String.format(Locale.US, "%,d", v)

private const val CACHE_NAME = "cf-usage"
private const val KIB = 1024.0

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
                val workers = topWorkers(items.map { it.by to it.limit })
                val colorOf = workerColors(workers)
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
        if (split) SegBar(u.by, u.limit, colorOf!!) else ProgressBar(u.ratio.coerceIn(0f, 1f))
        Text(detail ?: "${num(u.used)} / ${num(u.limit)} ${u.unit}", c.textSecondary, 12)
        if (open) PartList(u.by, colorOf!!) { "${num(it)} ${u.unit}" }
    }
}

