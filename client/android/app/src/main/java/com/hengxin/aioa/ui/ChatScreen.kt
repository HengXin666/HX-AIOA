package com.hengxin.aioa.ui

import android.text.format.DateFormat
import android.text.format.DateUtils
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.R
import java.util.TimeZone
import com.hengxin.aioa.data.MessageDb
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.proto.ServerFrame
import com.hengxin.aioa.ui.chat.LetterAvatar
import com.hengxin.aioa.ui.chat.MarkdownText
import com.hengxin.aioa.ui.chat.MdColors
import com.hengxin.aioa.ui.chat.colorOf

internal val PAD = 12.dp
private val ONLINE = Color(0xFF34C759)
private val OFFLINE = Color(0xFFFF9500)
private val BUBBLE_R = 16.dp
private val BUBBLE_TAIL = 4.dp
private val SENDER_AVATAR = 34.dp
private val HEADER_AVATAR = 36.dp
private val PILL = RoundedCornerShape(50)
private const val BACK_ROTATE = 90f
// 同一个人连续发且间隔不超过这个时间, 合并成一串, 只在第一条显示名字与头像
private const val RUN_GAP_MS = 3 * 60_000L

// 列表项; 列表倒序排放 (最新在最下, 但索引 0 是最新), 这样新消息进来不用滚动, 也自带动画
private sealed interface ChatRow {
    val key: String

    data class Day(val ts: Long, val seq: Long) : ChatRow {
        override val key get() = "d$seq"
    }

    data class Bubble(val msg: ServerFrame.Msg, val head: Boolean, val tail: Boolean) : ChatRow {
        override val key get() = "m${msg.seq}"
    }
}

/** 消息栏: 未进群时是群列表, 点进去是该群的消息; 只有 "备忘" 群能发消息。 */
@Composable
fun ChatScreen(model: ChatModel) {
    val groups = model.groups
    val open = groups.open
    if (open == null) {
        GroupList(model)
        return
    }
    BackHandler { groups.close() }
    Column(Modifier.fillMaxSize().imePadding()) {
        ChatTopBar(open, groups.messages.size, model.online) { groups.close() }
        MessageList(groups.messages, model::isMine, showSender = open != MessageDb.MEMO_GROUP, Modifier.weight(1f))
        if (open == MessageDb.MEMO_GROUP) Composer(model::send)
    }
}

/** 普通页面标题行 (群列表等在用)。 */
@Composable
internal fun Header(title: String, online: Boolean, onBack: (() -> Unit)? = null, action: (@Composable () -> Unit)? = null) {
    Row(Modifier.fillMaxWidth().padding(horizontal = PAD, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        if (onBack != null) BackButton(onBack)
        Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, maxLines = 1)
        Box(Modifier.padding(start = 8.dp).size(8.dp).background(if (online) ONLINE else OFFLINE, CircleShape))
        Text(
            stringResource(if (online) R.string.status_online else R.string.status_offline),
            Modifier.padding(start = 4.dp).weight(1f),
            fontSize = 12.sp,
            color = MaterialTheme.colorScheme.outline,
        )
        action?.invoke()
    }
}

@Composable
private fun BackButton(onBack: () -> Unit) {
    Box(Modifier.size(36.dp).clickable(onClick = onBack), contentAlignment = Alignment.Center) {
        Icon("chevron-down", MaterialTheme.colorScheme.onSurface, 22.dp, Modifier.rotate(BACK_ROTATE))
    }
}

@Composable
private fun ChatTopBar(group: String, count: Int, online: Boolean, onBack: () -> Unit) {
    val c = MaterialTheme.colorScheme
    Column {
        Row(Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            BackButton(onBack)
            LetterAvatar(group, HEADER_AVATAR)
            Column(Modifier.padding(start = 10.dp).weight(1f)) {
                Text(group, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
                val status = stringResource(if (online) R.string.status_online else R.string.status_offline)
                Text("$count 条消息 · $status", fontSize = 12.sp, color = if (online) c.outline else OFFLINE)
            }
        }
        Box(Modifier.fillMaxWidth().size(0.5.dp).background(c.outlineVariant))
    }
}

private fun dayOf(ts: Long): Long = (ts + TimeZone.getDefault().getOffset(ts)) / DateUtils.DAY_IN_MILLIS

private fun sameDay(a: Long, b: Long): Boolean = dayOf(a) == dayOf(b)

// 由旧到新扫一遍, 再整体倒过来交给倒序列表
private fun buildRows(messages: List<ServerFrame.Msg>): List<ChatRow> {
    val rows = ArrayList<ChatRow>(messages.size + 8)
    for (i in messages.indices) {
        val m = messages[i]
        val prev = messages.getOrNull(i - 1)
        val next = messages.getOrNull(i + 1)
        val newDay = prev == null || !sameDay(prev.ts, m.ts)
        if (newDay) rows.add(ChatRow.Day(m.ts, m.seq))
        val head = newDay || prev!!.src != m.src || m.ts - prev.ts > RUN_GAP_MS
        val tail = next == null || next.src != m.src || next.ts - m.ts > RUN_GAP_MS || !sameDay(m.ts, next.ts)
        rows.add(ChatRow.Bubble(m, head, tail))
    }
    rows.reverse()
    return rows
}

@Composable
private fun MessageList(messages: List<ServerFrame.Msg>, isMine: (ServerFrame.Msg) -> Boolean, showSender: Boolean, modifier: Modifier) {
    val rows = remember(messages.size, messages.lastOrNull()?.seq) { buildRows(messages.distinctBy { it.seq }) }
    val state = rememberLazyListState()
    // 停在底部时新消息自动跟上; 用户往上翻着看就不打扰
    LaunchedEffect(rows.firstOrNull()?.key) {
        if (state.firstVisibleItemIndex <= 1) state.animateScrollToItem(0)
    }
    LazyColumn(
        modifier.fillMaxWidth(),
        state,
        reverseLayout = true,
        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 8.dp),
    ) {
        items(rows.size, key = { rows[it].key }, contentType = { if (rows[it] is ChatRow.Day) 0 else 1 }) { i ->
            val mod = Modifier.animateItem()
            when (val row = rows[i]) {
                is ChatRow.Day -> DayChip(row.ts, mod)
                is ChatRow.Bubble -> Bubble(row, isMine(row.msg), showSender, mod)
            }
        }
    }
}

@Composable
private fun DayChip(ts: Long, modifier: Modifier) {
    val context = LocalContext.current
    val text = when {
        DateUtils.isToday(ts) -> "今天"
        DateUtils.isToday(ts + DateUtils.DAY_IN_MILLIS) -> "昨天"
        else -> DateUtils.formatDateTime(context, ts, DateUtils.FORMAT_SHOW_DATE or DateUtils.FORMAT_SHOW_WEEKDAY)
    }
    Box(modifier.fillMaxWidth().padding(vertical = 10.dp), contentAlignment = Alignment.Center) {
        Text(
            text,
            Modifier.background(MaterialTheme.colorScheme.surfaceVariant, PILL).padding(horizontal = 10.dp, vertical = 3.dp),
            fontSize = 12.sp,
            color = MaterialTheme.colorScheme.outline,
        )
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun Bubble(row: ChatRow.Bubble, mine: Boolean, showSender: Boolean, modifier: Modifier) {
    val c = MaterialTheme.colorScheme
    val msg = row.msg
    var menu by remember { mutableStateOf(false) }
    val clipboard = LocalClipboardManager.current
    val shape = when {
        mine -> RoundedCornerShape(BUBBLE_R, if (row.head) BUBBLE_TAIL else BUBBLE_R, BUBBLE_R, BUBBLE_R)
        else -> RoundedCornerShape(if (row.head) BUBBLE_TAIL else BUBBLE_R, BUBBLE_R, BUBBLE_R, BUBBLE_R)
    }
    val bg = if (mine) c.primary else c.surfaceVariant
    val fg = if (mine) c.onPrimary else c.onSurface
    val muted = fg.copy(alpha = 0.6f)
    val md = MdColors(fg, muted, if (mine) fg else c.primary, fg.copy(alpha = 0.1f))
    Row(
        modifier.fillMaxWidth().padding(top = if (row.head) 6.dp else 2.dp),
        horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,
        verticalAlignment = Alignment.Top,
    ) {
        if (!mine && showSender) {
            if (row.head) LetterAvatar(msg.src, SENDER_AVATAR) else Spacer(Modifier.width(SENDER_AVATAR))
            Spacer(Modifier.width(6.dp))
        }
        Box {
            Column(
                Modifier.widthIn(max = 290.dp)
                    .background(bg, shape)
                    .combinedClickable(onClick = {}, onLongClick = { menu = true })
                    .padding(start = 11.dp, end = 11.dp, top = 7.dp, bottom = 5.dp),
            ) {
                if (!mine && showSender && row.head) {
                    Text(msg.src, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = colorOf(msg.src), maxLines = 1)
                }
                MarkdownText(msg.text, md)
                Text(timeOf(msg.ts), Modifier.align(Alignment.End), fontSize = 10.sp, color = muted)
            }
            DropdownMenu(menu, { menu = false }) {
                DropdownMenuItem({ Text("复制") }, { clipboard.setText(AnnotatedString(msg.text)); menu = false })
            }
        }
    }
}

@Composable
private fun timeOf(ts: Long): String = DateFormat.getTimeFormat(LocalContext.current).format(ts)

@Composable
private fun Composer(onSend: (String) -> Boolean) {
    val c = MaterialTheme.colorScheme
    var text by remember { mutableStateOf("") }
    Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.Bottom) {
        Box(Modifier.weight(1f).background(c.surfaceVariant, RoundedCornerShape(20.dp)).padding(horizontal = 14.dp, vertical = 10.dp)) {
            if (text.isEmpty()) Text(stringResource(R.string.input_hint), color = c.outline, fontSize = 15.sp)
            BasicTextField(
                text,
                { text = it },
                Modifier.fillMaxWidth(),
                textStyle = TextStyle(color = c.onSurface, fontSize = 15.sp),
                cursorBrush = SolidColor(c.primary),
                maxLines = 6,
            )
        }
        val ready = text.isNotBlank()
        Box(
            Modifier.padding(start = 8.dp).size(42.dp).background(if (ready) c.primary else c.surfaceVariant, CircleShape)
                .clickable(enabled = ready) { if (onSend(text)) text = "" },
            contentAlignment = Alignment.Center,
        ) {
            Icon("send", if (ready) c.onPrimary else c.outline, 20.dp)
        }
    }
}
