package com.hengxin.aioa.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupPositionProvider
import androidx.compose.ui.window.PopupProperties
import com.hengxin.aioa.Constants
import com.hengxin.aioa.data.MessageDb
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.pointerTap
import com.hengxin.aioa.proto.ServerFrame

private val ACT_W = 70.dp
private const val GAP_PX = 12

// 放在气泡上方, 上面放不下就放下方; 水平居中并夹在屏幕里
private object AboveOrBelow : PopupPositionProvider {
    override fun calculatePosition(anchorBounds: IntRect, windowSize: IntSize, layoutDirection: LayoutDirection, popupContentSize: IntSize): IntOffset {
        val x = (anchorBounds.left + (anchorBounds.width - popupContentSize.width) / 2).coerceIn(0, maxOf(0, windowSize.width - popupContentSize.width))
        val above = anchorBounds.top - popupContentSize.height - GAP_PX
        val y = if (above >= 0) above else (anchorBounds.bottom + GAP_PX).coerceAtMost(maxOf(0, windowSize.height - popupContentSize.height))
        return IntOffset(x, y)
    }
}

/** 能不能撤回: 自己的 2 分钟内, 管理员随时 (服务端再校验)。 */
fun canRecall(msg: ServerFrame.Msg, admin: Boolean, now: Long = System.currentTimeMillis()): Boolean =
    msg.seq > 0 && (admin || (msg.mine && now - msg.ts <= Constants.RECALL_WINDOW_MS))

/** 长按消息 (对齐 QQ, #136): 气泡上方两排 复制, 转发, 收藏, 回复 / 多选, 精选, 撤回, 删除。 */
@Composable
internal fun MessageMenu(msg: ServerFrame.Msg, a: BubbleActions, onCopy: () -> Unit, close: () -> Unit) {
    val c = Aioa.colors
    var confirm by remember { mutableStateOf(false) }
    var digest by remember { mutableStateOf(false) }
    if (confirm) {
        AlertDialog(
            onDismissRequest = { confirm = false; close() },
            title = { androidx.compose.material3.Text("删除这条消息?") },
            text = { androidx.compose.material3.Text("所有设备上都会删除, 不能恢复。") },
            confirmButton = { TextButton({ confirm = false; close(); a.onRemove(msg, MessageDb.DELETE_MODE) }) { androidx.compose.material3.Text("删除", color = MaterialTheme.colorScheme.error) } },
            dismissButton = { TextButton({ confirm = false; close() }) { androidx.compose.material3.Text("取消") } },
        )
        return
    }
    val shape = RoundedCornerShape(16.dp)
    val run = { f: () -> Unit -> { f(); close() } }
    Popup(popupPositionProvider = AboveOrBelow, onDismissRequest = close, properties = PopupProperties(focusable = true)) {
        Column(
            Modifier.shadow(16.dp, shape).clip(shape).background(c.popover).border(1.dp, c.border.copy(alpha = 0.6f), shape).padding(10.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row {
                Act("copy", "复制", onClick = run(onCopy))
                Act("forward", "转发", onClick = run { a.onForward(msg) })
                Act("star", if (a.isFavorite(msg.seq)) "取消收藏" else "收藏", onClick = run { a.onFavorite(msg) })
                Act("corner-up-left", "回复", onClick = run { a.onReply(msg) })
            }
            Row {
                a.onSelect?.let { sel -> Act("list-checks", "多选", onClick = run { sel(msg) }) }
                if (a.digests.isNotEmpty()) Act("sparkles", "精选") {
                    if (a.digests.size == 1) run { a.onDigest(msg, a.digests[0].first) }() else digest = !digest
                }
                if (canRecall(msg, a.admin)) Act("undo-2", "撤回", onClick = run { a.onRemove(msg, MessageDb.RECALL_MODE) })
                Act("trash-2", "删除", c.danger) { confirm = true }
            }
            if (digest) a.digests.forEach { (key, label) ->
                Row(Modifier.clip(RoundedCornerShape(10.dp)).pointerTap(run { a.onDigest(msg, key) }).padding(horizontal = 10.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon("sparkles", c.textSecondary, 14.dp)
                    Text("收录到 $label", c.text, 14)
                }
            }
        }
    }
}

@Composable
internal fun Act(icon: String, label: String, tone: Color = Aioa.colors.text, onClick: () -> Unit) {
    Column(
        Modifier.width(ACT_W).clip(RoundedCornerShape(10.dp)).pointerTap(onClick).padding(vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(icon, tone, 20.dp)
        Text(label, tone, 12)
    }
}
