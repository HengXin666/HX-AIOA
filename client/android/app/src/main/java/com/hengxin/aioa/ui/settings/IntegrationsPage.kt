package com.hengxin.aioa.ui.settings

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.Constants
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.net.Api
import com.hengxin.aioa.net.ApiCache
import com.hengxin.aioa.kit.HomeSection
import com.hengxin.aioa.ui.OneRow
import com.hengxin.aioa.ui.RowAction
import com.hengxin.aioa.ui.SubPage
import com.hengxin.aioa.ui.ago
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/** 接入总览的一行: 一把 key。kind 为 push (消息源) / interactive (交互 Agent) / probe / other。 */
data class Integration(
    val keyId: String,
    val name: String,
    val prefix: String,
    val kind: String,
    val group: String?,
    val reads: List<String>,
    val sourceType: String?,
    val agents: List<Pair<String, Boolean>>,
    val lastActive: Long,
)

private const val PATH = "api/v1/integrations"
private const val CACHE = "integrations"
private const val KIND_PUSH = "push"
private const val KIND_INTERACTIVE = "interactive"
private const val REVOKE = "作废"
private const val SOURCE_AGENT = "agent"
private const val DELETE = "DELETE"

private val SECTIONS = listOf(
    KIND_PUSH to ("消息源" to "单向推送: 定时任务, 群里接入的 Agent, webhook。它们只往群里发消息。"),
    KIND_INTERACTIVE to ("交互 Agent" to "Codex 这类: 干完活推给你, 你还能在任务卡上回复, 批准或叫停。"),
)

private fun strings(a: JSONArray?) = (0 until (a?.length() ?: 0)).mapNotNull { a?.optString(it)?.ifEmpty { null } }

private fun parse(body: JSONObject?): List<Integration> {
    val arr = body?.optJSONArray("integrations") ?: return emptyList()
    return (0 until arr.length()).mapNotNull { i ->
        val o = arr.optJSONObject(i) ?: return@mapNotNull null
        val ag = o.optJSONArray("agents")
        Integration(
            keyId = o.optString("keyId"),
            name = o.optString("name"),
            prefix = o.optString("prefix"),
            kind = o.optString("kind"),
            group = o.optString("group").ifEmpty { null },
            reads = strings(o.optJSONArray("reads")),
            sourceType = o.optJSONObject("source")?.optString("type"),
            agents = (0 until (ag?.length() ?: 0)).mapNotNull { j -> ag?.optJSONObject(j)?.let { it.optString("name") to it.optBoolean("online") } },
            lastActive = o.optLong("lastActive"),
        )
    }.sortedByDescending { it.lastActive }
}

// 群里接入的 Agent 走群接口作废 (顺带更新群资料), 其它直接删 key
private fun revoke(context: Context, it: Integration): String? =
    if (it.sourceType == SOURCE_AGENT && it.group != null) {
        Api.call(context, DELETE, listOf(Constants.CHATS_API, it.group, "agents", it.keyId)).error
    } else {
        Api.call(context, DELETE, listOf(Constants.KEYS_PATH, it.keyId)).error
    }

/** 接入总览: 我注册过的每把 key, 按消息源 / 交互 Agent 分开, 看最近活跃并可作废。 */
@Composable
fun IntegrationsPage(onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var list by remember { mutableStateOf<List<Integration>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirm by remember { mutableStateOf<Integration?>(null) }
    val refresh = {
        scope.launch {
            val r = withContext(Dispatchers.IO) { ApiCache.refresh(context, CACHE, listOf(PATH)) }
            if (r.changed || list == null) list = parse(r.body ?: withContext(Dispatchers.IO) { ApiCache.read(context, CACHE) })
            error = r.error
        }
    }
    LaunchedEffect(Unit) {
        list = parse(withContext(Dispatchers.IO) { ApiCache.read(context, CACHE) }).ifEmpty { null }
        refresh()
    }
    Box(Modifier.fillMaxSize().background(Aioa.colors.background)) {
        SubPage("接入总览", onBack, "刷新" to { refresh(); Unit }) {
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp) }
            val all = list
            if (all == null) Text("加载中...", color = MaterialTheme.colorScheme.outline)
            else {
                SECTIONS.forEach { (kind, label) -> Section(label.first, label.second, all.filter { it.kind == kind }) { confirm = it } }
                val rest = all.filter { it.kind != KIND_PUSH && it.kind != KIND_INTERACTIVE }
                if (rest.isNotEmpty()) Section("其它", "探针与只读 key。", rest) { confirm = it }
            }
        }
    }
    confirm?.let { item ->
        AlertDialog(
            onDismissRequest = { confirm = null },
            title = { Text("作废 ${item.name}?") },
            text = { Text("这把 key (${item.prefix}...) 立即失效, 已发的消息保留。之后要用得重新接入。") },
            confirmButton = {
                TextButton({
                    confirm = null
                    scope.launch {
                        error = withContext(Dispatchers.IO) { revoke(context, item) }
                        refresh()
                    }
                }) { Text(REVOKE, color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton({ confirm = null }) { Text("取消") } },
        )
    }
}

@Composable
private fun Section(title: String, hint: String, items: List<Integration>, onRevoke: (Integration) -> Unit) {
    val k = Aioa.colors
    HomeSection(title, items.size) {
        com.hengxin.aioa.kit.Text(hint, k.textSecondary, 12, Modifier.padding(start = 14.dp, end = 14.dp, top = 10.dp), maxLines = 3)
        if (items.isEmpty()) com.hengxin.aioa.kit.Text("还没有", k.textSecondary, 13, Modifier.padding(14.dp))
        Column(Modifier.padding(horizontal = 14.dp, vertical = 4.dp)) { items.forEach { IntegrationRow(it, onRevoke) } }
    }
}

/** 一行一条 (#138): 状态点 / 图标, 名字, 所在群与活跃时间压到右边, 最右作废。 */
@Composable
private fun IntegrationRow(it: Integration, onRevoke: (Integration) -> Unit) {
    val k = Aioa.colors
    val online = it.agents.any { a -> a.second }
    val meta = listOfNotNull(
        it.group?.let { g -> "群 $g" },
        it.reads.takeIf { r -> r.isNotEmpty() }?.let { r -> "可读 ${r.size}" },
        if (it.lastActive > 0) ago(it.lastActive) else "还没动静",
    ).joinToString(" · ")
    val icon = if (it.kind == KIND_INTERACTIVE) "bot" else "plug"
    OneRow(icon, it.name, meta, if (it.kind == KIND_INTERACTIVE && online) k.success else k.textSecondary) { RowAction(REVOKE, danger = true) { onRevoke(it) } }
}
