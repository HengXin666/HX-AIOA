package com.hengxin.aioa.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.Constants
import com.hengxin.aioa.data.MessageDb
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.proto.ServerFrame
import com.hengxin.aioa.ui.chat.ActionSheet
import com.hengxin.aioa.ui.chat.SheetAction

/** 多选状态 (#136): null 为不在多选。 */
class Picking {
    var seqs by mutableStateOf<Set<Long>?>(null)
        private set
    val on get() = seqs != null

    fun start(seq: Long?) {
        seqs = setOfNotNull(seq?.takeIf { it > 0 })
    }

    fun toggle(seq: Long) {
        val s = seqs ?: return
        if (seq > 0) seqs = if (seq in s) s - seq else s + seq
    }

    fun stop() {
        seqs = null
    }
}

private enum class Batch { EACH, BUNDLE, DELETE }

/** 多选底栏: 逐条转发 / 合并转发 / 收藏 / 删除。 */
@Composable
internal fun SelectBar(model: ChatModel, group: String, picking: Picking) {
    val c = Aioa.colors
    val g = model.groups
    val dir = g.directory
    var batch by remember { mutableStateOf<Batch?>(null) }
    val chosen = (picking.seqs ?: emptySet()).let { s -> g.messages.filter { it.seq in s && it.deleted == null }.sortedBy { it.seq } }
    val ready = chosen.isNotEmpty()
    Column(Modifier.fillMaxWidth().background(c.sidebar)) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.border.copy(alpha = 0.6f)))
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            val tone = if (ready) c.text else c.textSecondary
            Act("forward", "逐条转发", tone) { if (ready) batch = Batch.EACH }
            Act("layers", "合并转发", tone) { if (ready) batch = Batch.BUNDLE }
            Act("star", "收藏", tone) {
                if (ready) {
                    chosen.filter { !dir.isFavorite(it.seq) }.forEach(dir::toggleFavorite)
                    picking.stop()
                }
            }
            Act("trash-2", "删除", if (ready) c.danger else c.textSecondary) { if (ready) batch = Batch.DELETE }
        }
    }
    when (batch) {
        Batch.EACH -> ForwardSheet(model, "逐条转发到", { batch = null }) { key ->
            chosen.forEach { g.forward(it, key) }
            picking.stop()
        }
        Batch.BUNDLE -> ForwardSheet(model, "合并转发到", { batch = null }) { key ->
            g.sendBundle(key, dir.title(group), chosen.map { it.seq }.take(Constants.BUNDLE_MAX))
            picking.stop()
        }
        Batch.DELETE -> { val admin = dir.metas[group]?.canManage == true; AlertDialog(
            onDismissRequest = { batch = null },
            title = { Text("删除 ${chosen.size} 条消息?") },
            text = { Text(if (admin) "群里所有人都看不到了, 不能恢复。" else "只从本机删除, 群里其他人仍能看到。") },
            confirmButton = {
                TextButton({
                    chosen.forEach { g.remove(it, if (admin) MessageDb.DELETE_MODE else MessageDb.LOCAL_MODE) }
                    batch = null
                    picking.stop()
                }) { Text("删除", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton({ batch = null }) { Text("取消") } },
        ) }
        null -> Unit
    }
}

/** 选一个会话 (转发, 合并转发); 抽屉一行一个。 */
@Composable
internal fun ForwardSheet(model: ChatModel, title: String, close: () -> Unit, onPick: (String) -> Unit) {
    val g = model.groups
    val rows = remember { g.rows() }
    ActionSheet(title, rows.map { r -> SheetAction(if (r.meta?.isDm == true) "user" else "message-circle", r.meta?.title ?: r.key) { onPick(r.key); close() } }, close)
}

/** 转发一条 (气泡长按, 收藏页)。 */
@Composable
internal fun ForwardDialog(model: ChatModel, msg: ServerFrame.Msg, close: () -> Unit) =
    ForwardSheet(model, "转发到", close) { key -> model.groups.forward(msg, key) }
