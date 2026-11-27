package com.hengxin.aioa.ui.chat

import android.content.Context
import android.text.format.DateFormat
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.hengxin.aioa.Constants
import com.hengxin.aioa.data.MessageDb
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.net.Api
import com.hengxin.aioa.proto.Bundle
import com.hengxin.aioa.proto.ServerFrame
import com.hengxin.aioa.proto.V1Decode
import com.hengxin.aioa.proto.toMsg
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private const val HEAD_LINES = 4
private const val GET = "GET"
private val FACE = 32.dp

/** 合并转发卡片 (#132): "<群> 的聊天记录", 前 4 条摘要, 底部 "聊天记录 · n 条"。 */
@Composable
fun BundleCard(b: Bundle) {
    val c = Aioa.colors
    Column(Modifier.padding(vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("${b.from.ifEmpty { "群" }} 的聊天记录", c.text, 15, weight = FontWeight.SemiBold)
        b.head.take(HEAD_LINES).forEach { Text("${it.src}: ${plainPreview(it.text)}", c.textSecondary, 13) }
        Box(Modifier.padding(vertical = 4.dp).fillMaxWidth().height(1.dp).background(c.border.copy(alpha = 0.6f)))
        Text("聊天记录 · ${b.count} 条", c.textSecondary, 12)
    }
}

/**
 * 按 refs 取原消息: 本地库有的先用, 缺的一次批量问服务端 (GET /events/seq?seqs=&via=)。
 * via 是卡片自己的 seq: 能读到卡片就能读它引用的别的群的消息 (#132)。
 */
suspend fun loadBundle(context: Context, refs: List<Long>, via: Long): Map<Long, ServerFrame.Msg> = withContext(Dispatchers.IO) {
    val local = MessageDb.get(context).bySeqs(refs).filter { it.deleted == null }.associateBy { it.seq }
    val missing = refs.filter { it !in local }.take(Constants.BUNDLE_MAX)
    if (missing.isEmpty()) return@withContext local
    val r = Api.call(context, GET, listOf(Constants.EVENTS_SEQ_PATH), query = mapOf("seqs" to missing.joinToString(","), "via" to via.toString()))
    val arr = r.body?.optJSONArray("events")
    val remote = (0 until (arr?.length() ?: 0)).mapNotNull { i -> arr?.optJSONObject(i)?.let { runCatching { V1Decode.envelope(it).toMsg() }.getOrNull() } }
        .filter { it.deleted == null }.associateBy { it.seq }
    local + remote
}

/** 点开合并转发: 只读的小会话页, 盖住当前页, 返回关闭。 */
@Composable
fun BundleView(b: Bundle, via: Long, close: () -> Unit) {
    val c = Aioa.colors
    val context = LocalContext.current
    val msgs by produceState<Map<Long, ServerFrame.Msg>?>(null, b, via) { value = runCatching { loadBundle(context, b.refs, via) }.getOrDefault(emptyMap()) }
    Dialog(close, DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Column(Modifier.fillMaxSize().background(c.background).safeDrawingPadding()) {
            SubBar("${b.from.ifEmpty { "群" }} 的聊天记录", "${b.count} 条", close, right = null)
            val got = msgs
            LazyColumn(Modifier.weight(1f).padding(horizontal = 14.dp)) {
                if (got == null) item { Text("正在取原消息…", c.textSecondary, 13, Modifier.padding(vertical = 16.dp)) }
                else b.refs.forEach { seq ->
                    item(key = seq) {
                        val m = got[seq]
                        if (m == null) Text("这条消息已撤回或不在了", c.textSecondary, 13, Modifier.padding(vertical = 10.dp))
                        else BundleLineRow(m)
                    }
                }
            }
        }
    }
}

@Composable
private fun BundleLineRow(m: ServerFrame.Msg) {
    val c = Aioa.colors
    val context = LocalContext.current
    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        SenderAvatar(m, FACE)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(Modifier.weight(1f)) { Text(Names.of(m), c.textSecondary, 12) }
                Text(DateFormat.getTimeFormat(context).format(m.ts), c.textSecondary, 12)
            }
            val nested = m.bundle
            Column(Modifier.clip(RoundedCornerShape(12.dp)).background(c.surface).padding(horizontal = 12.dp, vertical = 9.dp)) {
                // 合并转发里套合并转发只展开一层: 里面那张只显示卡片
                if (nested != null) BundleCard(nested)
                else MarkdownText(m.text, MdColors(c.text, c.textSecondary, c.accent, c.text.copy(alpha = 0.1f)))
            }
        }
    }
}
