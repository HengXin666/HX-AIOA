package com.hengxin.aioa.ui.settings

import androidx.compose.foundation.layout.Arrangement
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

private class Usage(val label: String, val used: Long, val limit: Long, val unit: String) {
    val ratio get() = if (limit > 0) used.toFloat() / limit else 0f
}

private fun parse(o: JSONObject): List<Usage> {
    val arr = o.optJSONArray("items") ?: return emptyList()
    return (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }
        .map { Usage(it.optString("label"), it.optLong("used"), it.optLong("limit"), it.optString("unit")) }
}

private fun num(v: Long) = String.format(Locale.US, "%,d", v)

/** CF 额度: 今天 (UTC 0 点重置) 的免费额度用量, 服务端缓存 10 分钟; 任一项到 80% 会在 "CF 额度" 群提醒一次。 */
@Composable
fun CfUsagePage(onBack: (() -> Unit)?) {
    val context = LocalContext.current
    var reload by remember { mutableIntStateOf(0) }
    var body by remember { mutableStateOf<JSONObject?>(null) }
    var error by remember { mutableStateOf("") }
    LaunchedEffect(reload) {
        val r = withContext(Dispatchers.IO) { Api.call(context, "GET", listOf(PATH)) }
        body = r.body
        error = r.error.orEmpty()
    }
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
                SettingsGroup("${b.optString("day")} (UTC) · 截至 $at", footer = "免费计划每天 UTC 0 点 (北京时间 8 点) 重置。数据来自 CF 分析接口, 有几分钟延迟。") {
                    parse(b).forEachIndexed { i, u ->
                        if (i > 0) RowDivider()
                        UsageRow(u)
                    }
                }
                SettingsGroup { ActionRow(TEXT_REFRESH, ICON_REFRESH) { reload++ } }
            }
        }
    }
}

@Composable
private fun UsageRow(u: Usage) {
    val c = Aioa.colors
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(Modifier.fillMaxWidth()) {
            Text(u.label, c.text, 14, Modifier.weight(1f))
            Text("${(u.ratio * PCT).toInt()}%", if (u.ratio >= WARN) c.danger else c.textSecondary, 13)
        }
        ProgressBar(u.ratio.coerceIn(0f, 1f))
        Text("${num(u.used)} / ${num(u.limit)} ${u.unit}", c.textSecondary, 12)
    }
}
