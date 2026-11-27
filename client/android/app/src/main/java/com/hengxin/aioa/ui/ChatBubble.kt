package com.hengxin.aioa.ui

import com.hengxin.aioa.ui.chat.FileCard
import android.text.format.DateFormat
import com.hengxin.aioa.ui.feed.FeedBubble
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
import com.hengxin.aioa.ui.chat.Names
import com.hengxin.aioa.proto.MsgRef
import com.hengxin.aioa.proto.ServerFrame
import com.hengxin.aioa.ui.chat.HtmlCard
import com.hengxin.aioa.ui.chat.MarkdownText
import com.hengxin.aioa.ui.chat.MdColors
import com.hengxin.aioa.ui.chat.colorOf
import com.hengxin.aioa.ui.chat.plainPreview
import com.hengxin.aioa.ui.chat.tapHold
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.CheckBox
import com.hengxin.aioa.kit.SoftTag
import com.hengxin.aioa.kit.hxPalette
import androidx.compose.foundation.border

private val BUBBLE_R = 16.dp
private val BUBBLE_TAIL = 4.dp
private val SENDER_AVATAR = com.hengxin.aioa.ui.chat.MESSAGE_AVATAR
private val PICK_W = 36.dp
private const val AGENT_BORDER = 0.35f
const val ROLE_MEMBER_LABEL = "成员"
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
    // mode: recall / delete
    val onRemove: (ServerFrame.Msg, String) -> Unit = { _, _ -> },
    // 点 / 长按发送者头像: 资料卡 / 插入 @名字 (#136)
    val onAvatar: ((ServerFrame.Msg) -> Unit)? = null,
    val onAvatarLong: ((ServerFrame.Msg) -> Unit)? = null,
    // 多选: 进入多选并勾上这条; 多选中点一条是勾选 / 取消
    val onSelect: ((ServerFrame.Msg) -> Unit)? = null,
    val onBundle: ((ServerFrame.Msg) -> Unit)? = null,
    val admin: Boolean = false,
    val look: (ServerFrame.Msg) -> SenderLook = { SenderLook() },
    val atNames: List<String> = emptyList(),
)

/** 名字上面的身份: 群主 / 管理员 / 成员, 是不是群 Agent; avatar 为成员资料里的头像 id。 */
data class SenderLook(val role: String? = null, val agent: Boolean = false, val avatar: String? = null)

/** 一条气泡在列表里的位置: 是否一串的第一条 (显示名字与头像); picking 为多选中。 */
data class BubbleSpot(val head: Boolean, val showSender: Boolean, val highlight: Boolean, val picking: Boolean = false, val picked: Boolean = false)

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun MessageBubble(msg: ServerFrame.Msg, mine: Boolean, spot: BubbleSpot, actions: BubbleActions?, modifier: Modifier = Modifier, status: String? = null, onStatus: (() -> Unit)? = null) {
    val c = MaterialTheme.colorScheme
    if (msg.deleted != null) return RecalledLine(if (mine) "你" else Names.of(msg), modifier)
    var menu by remember { mutableStateOf(false) }
    val clipboard = LocalClipboardManager.current
    val look = actions?.look?.invoke(msg) ?: SenderLook()
    val tone = colorOf(msg.sid ?: msg.src)
    val shape = when {
        mine -> RoundedCornerShape(BUBBLE_R, if (spot.head) BUBBLE_TAIL else BUBBLE_R, BUBBLE_R, BUBBLE_R)
        else -> RoundedCornerShape(if (spot.head) BUBBLE_TAIL else BUBBLE_R, BUBBLE_R, BUBBLE_R, BUBBLE_R)
    }
    val card = msg.bundle != null
    val bg = if (mine && !card) c.primary else c.surfaceVariant
    val fg = if (mine && !card) c.onPrimary else c.onSurface
    val muted = fg.copy(alpha = 0.65f)
    val md = MdColors(fg, muted, if (mine) fg else c.primary, fg.copy(alpha = 0.1f), actions?.atNames.orEmpty())
    val rowBg by animateColorAsState(if (spot.highlight || spot.picked) c.primary.copy(alpha = HIGHLIGHT_ALPHA) else Color.Transparent, label = "hl")
    val pick = actions?.onSelect.takeIf { spot.picking }
    Row(
        modifier.fillMaxWidth().background(rowBg).then(if (pick != null) Modifier.clickable { pick(msg) } else Modifier).padding(top = if (spot.head) 6.dp else 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (spot.picking) Box(Modifier.width(PICK_W)) { CheckBox(spot.picked) }
        Row(Modifier.weight(1f), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start, verticalAlignment = Alignment.Top) {
            if (!mine && spot.showSender) {
                if (spot.head) {
                    val face = Modifier.tapHold({ actions?.onAvatar?.invoke(msg) }, actions?.onAvatarLong?.let { l -> { l(msg) } })
                    // 名字与头像按主人设的为准, 没设头像时群 Agent 用圆角方块机器人 (#128 #136)
                    com.hengxin.aioa.ui.chat.SenderFace(msg.sid, Names.of(msg), SENDER_AVATAR, face, look.avatar, look.agent)
                } else Spacer(Modifier.width(SENDER_AVATAR))
                Spacer(Modifier.width(8.dp))
            }
            Column(horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
                if (!mine && spot.showSender && spot.head) Who(Names.of(msg), look, tone)
                Box {
                    val border = if (look.agent && !mine) Modifier.border(1.dp, tone.copy(alpha = AGENT_BORDER), shape) else if (card) Modifier.border(1.dp, c.outlineVariant, shape) else Modifier
                    Column(
                        Modifier.widthIn(max = if (msg.feed != null) 340.dp else 290.dp)
                            .background(bg, shape)
                            .then(border)
                            .combinedClickable(
                                onClick = { if (pick != null) pick(msg) else if (card) actions?.onBundle?.invoke(msg) else onStatus?.invoke() },
                                onLongClick = { if (actions != null && pick == null) menu = true },
                            )
                            .padding(start = 11.dp, end = 11.dp, top = 7.dp, bottom = 5.dp),
                    ) {
                        msg.fwd?.let { Text("转发自 ${it.src}", fontSize = 12.sp, color = muted, modifier = Modifier.padding(bottom = 2.dp)) }
                        msg.reply?.let { QuoteBlock(it, fg, if (mine) fg else c.primary) { actions?.onJump?.invoke(it.seq) } }
                        val time: @Composable () -> Unit = {
                            Text(status ?: timeOf(msg.ts), fontSize = 10.sp, color = if (status != null && onStatus != null) c.error else muted)
                        }
                        val html = msg.html
                        val bundle = msg.bundle
                        if (bundle != null) {
                            com.hengxin.aioa.ui.chat.BundleCard(bundle)
                            Box(Modifier.align(Alignment.End)) { time() }
                        } else if (msg.feed != null) {
                            FeedBubble(msg, time)
                        } else if (html != null) {
                            // HTML 卡片的 "全屏" 和时间同一行
                            HtmlCard(html, Modifier.padding(top = 2.dp), footer = time)
                        } else {
                            msg.file?.let { FileCard(it, fg, Modifier.padding(top = 2.dp, bottom = 2.dp)) }
                            // 只发文件时正文就是 "[文件] 名字", 有文件卡就不重复
                            if (msg.file == null || !msg.text.startsWith(FILE_TEXT_PREFIX)) MarkdownText(msg.text, md)
                            Box(Modifier.align(Alignment.End)) { time() }
                        }
                    }
                    if (actions != null && menu) MessageMenu(msg, actions, onCopy = { clipboard.setText(AnnotatedString(com.hengxin.aioa.ui.chat.copyText(msg))) }) { menu = false }
                }
            }
        }
    }
}

/** 气泡上面一行: 身份标签, Agent 标签, 名字。 */
@Composable
private fun Who(name: String, look: SenderLook, tone: Color) {
    val k = Aioa.colors
    Row(Modifier.padding(bottom = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        look.role?.let { SoftTag(it, if (it == ROLE_MEMBER_LABEL) k.textSecondary else hxPalette().chart3) }
        if (look.agent) SoftTag(com.hengxin.aioa.Constants.CLOUD_AGENT, tone)
        com.hengxin.aioa.kit.Text(name, k.textSecondary, 12)
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

/** 撤回后原位置只留一行灰字。 */
@Composable
private fun RecalledLine(who: String, modifier: Modifier) {
    Box(modifier.fillMaxWidth().padding(vertical = 4.dp), contentAlignment = Alignment.Center) {
        Text("$who 撤回了一条消息", fontSize = 12.sp, color = MaterialTheme.colorScheme.outline)
    }
}

@Composable
internal fun timeOf(ts: Long): String = DateFormat.getTimeFormat(LocalContext.current).format(ts)
