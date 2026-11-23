package com.hengxin.aioa.ui

import android.text.format.DateFormat
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.proto.MsgRef
import com.hengxin.aioa.proto.ServerFrame
import com.hengxin.aioa.ui.chat.LetterAvatar
import com.hengxin.aioa.ui.chat.HtmlCard
import com.hengxin.aioa.ui.chat.MarkdownText
import com.hengxin.aioa.ui.chat.MdColors
import com.hengxin.aioa.ui.chat.colorOf
import com.hengxin.aioa.ui.chat.plainPreview

private val BUBBLE_R = 16.dp
private val BUBBLE_TAIL = 4.dp
private val SENDER_AVATAR = 34.dp
private val QUOTE_SHAPE = RoundedCornerShape(6.dp)
private const val HIGHLIGHT_ALPHA = 0.18f

/** 气泡要用的动作, 由聊天页按当前群提供。 */
class BubbleActions(
    val onReply: (ServerFrame.Msg) -> Unit,
    val onForward: (ServerFrame.Msg) -> Unit,
    val onFavorite: (ServerFrame.Msg) -> Unit,
    val isFavorite: (Long) -> Boolean,
    val digests: List<Pair<String, String>>,
    val onDigest: (ServerFrame.Msg, String) -> Unit,
    val onJump: (Long) -> Unit,
)

/** 一条气泡在列表里的位置: 是否一串的第一条 (显示名字与头像)。 */
data class BubbleSpot(val head: Boolean, val showSender: Boolean, val highlight: Boolean)

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun MessageBubble(msg: ServerFrame.Msg, mine: Boolean, spot: BubbleSpot, actions: BubbleActions?, modifier: Modifier = Modifier, status: String? = null, onStatus: (() -> Unit)? = null) {
    val c = MaterialTheme.colorScheme
    var menu by remember { mutableStateOf(false) }
    val clipboard = LocalClipboardManager.current
    val shape = when {
        mine -> RoundedCornerShape(BUBBLE_R, if (spot.head) BUBBLE_TAIL else BUBBLE_R, BUBBLE_R, BUBBLE_R)
        else -> RoundedCornerShape(if (spot.head) BUBBLE_TAIL else BUBBLE_R, BUBBLE_R, BUBBLE_R, BUBBLE_R)
    }
    val bg = if (mine) c.primary else c.surfaceVariant
    val fg = if (mine) c.onPrimary else c.onSurface
    val muted = fg.copy(alpha = 0.65f)
    val md = MdColors(fg, muted, if (mine) fg else c.primary, fg.copy(alpha = 0.1f))
    val rowBg by animateColorAsState(if (spot.highlight) c.primary.copy(alpha = HIGHLIGHT_ALPHA) else Color.Transparent, label = "hl")
    Row(
        modifier.fillMaxWidth().background(rowBg).padding(top = if (spot.head) 6.dp else 2.dp),
        horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,
        verticalAlignment = Alignment.Top,
    ) {
        if (!mine && spot.showSender) {
            if (spot.head) LetterAvatar(msg.src, SENDER_AVATAR) else Spacer(Modifier.width(SENDER_AVATAR))
            Spacer(Modifier.width(6.dp))
        }
        Box {
            Column(
                Modifier.widthIn(max = 290.dp)
                    .background(bg, shape)
                    .combinedClickable(onClick = { onStatus?.invoke() }, onLongClick = { if (actions != null) menu = true })
                    .padding(start = 11.dp, end = 11.dp, top = 7.dp, bottom = 5.dp),
            ) {
                if (!mine && spot.showSender && spot.head) {
                    Text(msg.src, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = colorOf(msg.src), maxLines = 1)
                }
                msg.fwd?.let { Text("转发自 ${it.src}", fontSize = 12.sp, color = muted, modifier = Modifier.padding(bottom = 2.dp)) }
                msg.reply?.let { QuoteBlock(it, fg, if (mine) fg else c.primary) { actions?.onJump?.invoke(it.seq) } }
                val time: @Composable () -> Unit = {
                    Text(status ?: timeOf(msg.ts), fontSize = 10.sp, color = if (status != null && onStatus != null) c.error else muted)
                }
                val html = msg.html
                if (html != null) {
                    // HTML 卡片的 "全屏" 和时间同一行
                    HtmlCard(html, Modifier.padding(top = 2.dp), footer = time)
                } else {
                    MarkdownText(msg.text, md)
                    Box(Modifier.align(Alignment.End)) { time() }
                }
            }
            if (actions != null) BubbleMenu(menu, { menu = false }, msg, actions, onCopy = { clipboard.setText(AnnotatedString(msg.text)) })
        }
    }
}

@Composable
private fun QuoteBlock(ref: MsgRef, fg: Color, bar: Color, onClick: () -> Unit) {
    Row(
        Modifier.padding(bottom = 4.dp).height(IntrinsicSize.Min).background(fg.copy(alpha = 0.08f), QUOTE_SHAPE).clickable(onClick = onClick),
    ) {
        Box(Modifier.width(3.dp).fillMaxHeight().background(bar, QUOTE_SHAPE))
        Column(Modifier.padding(horizontal = 8.dp, vertical = 4.dp)) {
            Text(ref.src, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = bar, maxLines = 1)
            Text(plainPreview(ref.text), fontSize = 12.sp, color = fg.copy(alpha = 0.75f), maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun BubbleMenu(open: Boolean, close: () -> Unit, msg: ServerFrame.Msg, a: BubbleActions, onCopy: () -> Unit) {
    DropdownMenu(open, close) {
        DropdownMenuItem({ Text("复制") }, { onCopy(); close() })
        DropdownMenuItem({ Text("引用") }, { a.onReply(msg); close() })
        DropdownMenuItem({ Text("转发") }, { a.onForward(msg); close() })
        DropdownMenuItem({ Text(if (a.isFavorite(msg.seq)) "取消收藏" else "收藏") }, { a.onFavorite(msg); close() })
        a.digests.forEach { (key, label) -> DropdownMenuItem({ Text("收录到 $label") }, { a.onDigest(msg, key); close() }) }
    }
}

@Composable
internal fun timeOf(ts: Long): String = DateFormat.getTimeFormat(LocalContext.current).format(ts)
