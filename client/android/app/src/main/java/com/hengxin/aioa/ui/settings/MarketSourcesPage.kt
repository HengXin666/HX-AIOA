package com.hengxin.aioa.ui.settings

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Paragraph
import com.hengxin.aioa.net.Api
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private const val PATH = "api/v1/plugin-sources"
private const val PATH_REFRESH = "api/v1/plugin-sources-refresh"
private const val BODY_SP = 13

data class MarketSource(
    val id: String, val name: String, val link: String, val official: Boolean,
    val at: Long, val count: Int, val error: String?, val skipped: List<String>,
    // 私有仓库: 用 GitHub 授权读取, 插件只给主人
    val private: Boolean = false,
)

private fun parse(b: JSONObject?): List<MarketSource> {
    val arr = b?.optJSONArray("sources") ?: return emptyList()
    return (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }.map { o ->
        val sk = o.optJSONArray("skipped")
        MarketSource(
            o.optString("id"), o.optString("name"), o.optString("link"), o.optBoolean("official"),
            o.optLong("at"), o.optInt("count"), o.optString("error").ifEmpty { null },
            (0 until (sk?.length() ?: 0)).mapNotNull { sk?.optString(it) },
            o.optBoolean("private"),
        )
    }
}

private suspend fun call(context: Context, method: String, path: List<String>, body: JSONObject? = null) =
    withContext(Dispatchers.IO) { Api.call(context, method, path, body) }

private fun time(ts: Long) = SimpleDateFormat("MM-dd HH:mm", Locale.ROOT).format(Date(ts))

/** 市场源 (管理员): 官方源固定在最前, 可以加别的 GitHub 仓库, 移除, 手动刷新。 */
@Composable
fun MarketSourcesPage(onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val c = Aioa.colors
    var list by remember { mutableStateOf<List<MarketSource>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var link by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    fun run(block: suspend () -> com.hengxin.aioa.net.ApiReply) {
        busy = true
        error = null
        scope.launch {
            val r = block()
            if (r.error != null) error = r.error
            call(context, "GET", listOf(PATH)).body?.let { list = parse(it) }
            busy = false
        }
    }
    LaunchedEffect(Unit) { val r = call(context, "GET", listOf(PATH)); list = parse(r.body); error = r.error }
    SettingsPageFrame("市场源", onBack) {
        Paragraph("填 GitHub 仓库首页或目录链接 (仓库根目录或 plugins/ 下有 index.json)。私有仓库由主人添加, 用 GitHub 授权读取, 里面的插件只给主人。索引每 30 分钟最多拉一次, 介绍与提示词按版本缓存, 不常用时几乎不产生请求。", c.textSecondary, BODY_SP)
        error?.let { SettingsGroup { NoteRow(it, c.danger) } }
        SettingsGroup("添加") {
            InputRow("链接", link, "https://github.com/用户/仓库") { link = it }
            RowDivider()
            ActionRow(if (busy) "处理中..." else "添加", "plus", enabled = !busy && link.isNotBlank()) {
                run { call(context, "POST", listOf(PATH), JSONObject().put("link", link.trim())).also { if (it.error == null) link = "" } }
            }
        }
        list?.forEach { s ->
            val state = when {
                s.error != null -> "拉取失败: ${s.error}"
                s.at > 0 -> "${s.count} 个插件 · ${time(s.at)} 拉取"
                else -> "还没拉取"
            }
            val tag = when { s.official -> " (官方)"; s.private -> " (私有)"; else -> "" }
            SettingsGroup(s.name + tag, s.skipped.takeIf { it.isNotEmpty() }?.let { "跳过: ${it.joinToString("; ")}" }) {
                NoteRow(s.link, c.textSecondary)
                RowDivider(false)
                NoteRow(state, if (s.error != null) c.danger else null)
                if (!s.official) {
                    RowDivider()
                    ActionRow("移除", "trash-2", danger = true, enabled = !busy) { run { call(context, "DELETE", listOf(PATH, s.id)) } }
                }
            }
        }
        SettingsGroup {
            ActionRow("立即刷新全部", "refresh-cw", enabled = !busy) { run { call(context, "POST", listOf(PATH_REFRESH), JSONObject()) } }
        }
    }
}
