package com.hengxin.aioa.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.ProgressBar
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.net.Api
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

// CF 存储: R2/KV/D1 的大小与本期用量对照免费额度, 下面列出每个桶/库; 服务端缓存 5 分钟
private const val PATH = "api/v1/cf/storage"
private const val UNIT_BYTES = "B"
private const val WARN = 0.8f
private val KIND_LABEL = mapOf("r2" to "R2", "kv" to "KV", "d1" to "D1")

private fun JSONArray?.objs(): List<JSONObject> = this?.let { a -> (0 until a.length()).mapNotNull { a.optJSONObject(it) } }.orEmpty()

private fun bytesText(v: Long): String {
    val units = listOf("B", "KB", "MB", "GB", "TB")
    var x = v.toDouble()
    var i = 0
    while (x >= 1024 && i < units.lastIndex) { x /= 1024; i++ }
    return if (i == 0) "$v B" else String.format(Locale.US, "%.1f %s", x, units[i])
}

private fun amount(v: Long, unit: String) = if (unit == UNIT_BYTES) bytesText(v) else String.format(Locale.US, "%,d %s", v, unit)

private fun periodText(p: String) = when (p) {
    "月" -> "本月"
    "日" -> "今天"
    else -> "当前"
}

@Composable
fun CfStorageSection() {
    val context = LocalContext.current
    var body by remember { mutableStateOf(com.hengxin.aioa.ui.PageCache.get<JSONObject>(PATH)) }
    var error by remember { mutableStateOf("") }
    LaunchedEffect(Unit) {
        val r = withContext(Dispatchers.IO) { Api.call(context, "GET", listOf(PATH)) }
        r.body?.let { com.hengxin.aioa.ui.PageCache.put(PATH, it) }
        body = r.body ?: body
        error = r.error.orEmpty()
    }
    val c = Aioa.colors
    val b = body
    when {
        error.isNotEmpty() -> SettingsGroup("R2 / KV / D1") { NoteRow(error, c.danger) }
        b == null -> SettingsGroup("R2 / KV / D1") { NoteRow("加载中...") }
        !b.optBoolean("configured") -> Unit
        else -> {
            SettingsGroup("R2 / KV / D1 额度", footer = "R2 操作按月 (UTC) 计, KV 与 D1 按天; 存储量不重置。") {
                b.optJSONArray("quotas").objs().forEachIndexed { i, q ->
                    if (i > 0) RowDivider()
                    QuotaRow(q)
                }
                b.optJSONArray("errors").let { e -> (0 until (e?.length() ?: 0)).forEach { NoteRow(e!!.optString(it), c.danger) } }
            }
            val stores = b.optJSONArray("stores").objs()
            if (stores.isNotEmpty()) SettingsGroup("桶与数据库") {
                stores.forEachIndexed { i, s ->
                    if (i > 0) RowDivider()
                    StoreRow(s)
                }
            }
        }
    }
}

@Composable
private fun QuotaRow(q: JSONObject) {
    val c = Aioa.colors
    val used = q.optLong("used")
    val limit = q.optLong("limit")
    val unit = q.optString("unit")
    val ratio = if (limit > 0) used.toFloat() / limit else 0f
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(Modifier.fillMaxWidth()) {
            Text(q.optString("label"), c.text, 14, Modifier.weight(1f))
            Text(String.format(Locale.US, "%.1f%%", ratio * 100), if (ratio >= WARN) c.danger else c.textSecondary, 13)
        }
        ProgressBar(ratio.coerceIn(0f, 1f))
        Text("${periodText(q.optString("period"))} ${amount(used, unit)} / ${amount(limit, unit)}", c.textSecondary, 12)
    }
}

@Composable
private fun StoreRow(s: JSONObject) {
    val c = Aioa.colors
    val kind = KIND_LABEL[s.optString("kind")] ?: s.optString("kind")
    val detail = buildList {
        if (s.has("objects")) add("${s.optLong("objects")} 个对象")
        add("近期 ${s.optLong("ops")} 次操作")
    }.joinToString(" · ")
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(kind, c.accent, 12, Modifier.padding(end = 10.dp))
        Column(Modifier.weight(1f)) {
            Text(s.optString("name"), c.text, 14)
            Text(detail, c.textSecondary, 11)
        }
        Text(bytesText(s.optLong("bytes")), c.textSecondary, 13)
    }
}
