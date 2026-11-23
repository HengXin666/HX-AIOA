package com.hengxin.aioa.ui

import android.text.format.DateUtils
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.R
import com.hengxin.aioa.data.MessageDb
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.proto.ServerFrame
import com.hengxin.aioa.ui.chat.ChatAvatar
import com.hengxin.aioa.ui.chat.MailView
import com.hengxin.aioa.ui.chat.digestLabel
import com.hengxin.aioa.ui.chat.plainPreview
import kotlinx.coroutines.delay
import java.util.TimeZone

internal val PAD = 12.dp
private val ONLINE = Color(0xFF34C759)
private val OFFLINE = Color(0xFFFF9500)
private val HEADER_AVATAR = 38.dp
private val PILL = RoundedCornerShape(50)
private const val BACK_ROTATE = 90f
// 同一个人连续发且间隔不超过这个时间, 合并成一串, 只在第一条显示名字与头像
private const val RUN_GAP_MS = 3 * 60_000L
// 离最早一条还剩几项时开始翻上一页
private const val PREFETCH = 15
private const val HIGHLIGHT_MS = 1600L

// 列表项; 列表倒序排放 (最新在最下, 但索引 0 是最新), 这样新消息进来不用滚动, 也自带动画
private sealed interface ChatRow {
    val key: String

    data class Day(val ts: Long, val seq: Long) : ChatRow {
        override val key get() = "d$seq"
    }

    data class Bubble(val msg: ServerFrame.Msg, val head: Boolean) : ChatRow {
        override val key get() = "m${msg.seq}"
    }

    data class Local(val p: Pending) : ChatRow {
        override val key get() = "p${p.cid}"
    }
}

/** 消息栏: 群列表 / 收藏 / 某个群的消息 / 群设置。 */
@Composable
fun ChatScreen(model: ChatModel) {
    val g = model.groups
    if (g.favoritesOpen) {
        BackHandler { g.favoritesOpen = false }
        KeepState("chat:fav") { FavoritesPage(model) { g.favoritesOpen = false } }
        return
    }
    val open = g.open
    if (open == null) {
        KeepState("chat:list") { GroupList(model) }
        return
    }
    if (g.page == ChatPage.SETTINGS) {
        BackHandler { g.page = ChatPage.CHAT }
        KeepState("chat:set:$open") { GroupSettingsPage(model, open) { g.page = ChatPage.CHAT } }
        return
    }
    BackHandler { g.close() }
    var forwarding by remember { mutableStateOf<ServerFrame.Msg?>(null) }
    val dir = g.directory
    val actions = BubbleActions(
        onReply = { g.replyTo = it },
        onForward = { forwarding = it },
        onFavorite = dir::toggleFavorite,
        isFavorite = dir::isFavorite,
        digests = dir.digests().filter { it.channel != open }.map { it.channel to (it.title ?: it.channel) },
        onDigest = { m, key -> g.forward(m, key) },
        onJump = g::jumpTo,
        onRemove = g::remove,
    )
    Column(Modifier.fillMaxSize().imePadding()) {
        ChatTopBar(model, open) { g.close() }
        val err = g.error ?: dir.error
        if (err != null) Text(err, Modifier.fillMaxWidth().clickable { g.clearError() }.padding(horizontal = PAD, vertical = 4.dp), fontSize = 12.sp, color = MaterialTheme.colorScheme.error)
        // 进群设置再回来时停在原来的位置; 换群或退出群后是新的一页
        if (dir.metas[open]?.isMail == true) {
            KeepState("chat:mail:${g.visit}") { MailView(g.messages.lastOrNull()?.seq, Modifier.weight(1f)) }
        } else {
            KeepState("chat:msg:$open:${g.visit}") { MessageList(model, open, actions, Modifier.weight(1f)) }
            Composer(g)
        }
    }
    forwarding?.let { m -> ForwardDialog(model, m) { forwarding = null } }
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
internal fun BackButton(onBack: () -> Unit) {
    Box(Modifier.size(36.dp).clickable(onClick = onBack), contentAlignment = Alignment.Center) {
        Icon("chevron-down", MaterialTheme.colorScheme.onSurface, 22.dp, Modifier.rotate(BACK_ROTATE))
    }
}

@Composable
private fun ChatTopBar(model: ChatModel, group: String, onBack: () -> Unit) {
    val c = MaterialTheme.colorScheme
    val meta = model.groups.directory.metas[group]
    Column {
        Row(Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            BackButton(onBack)
            Row(Modifier.weight(1f).clickable { model.groups.page = ChatPage.SETTINGS }, verticalAlignment = Alignment.CenterVertically) {
                ChatAvatar(group, meta?.avatar, HEADER_AVATAR)
                Column(Modifier.padding(start = 10.dp)) {
                    Text(meta?.title ?: group, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    val tags = listOfNotNull(
                        if (model.online) null else stringResource(R.string.status_offline),
                        digestLabel(meta?.digest),
                        if (meta?.muted == true) "免打扰" else null,
                        meta?.agents?.size?.takeIf { it > 0 }?.let { "$it 个 Agent" },
                    )
                    Text(tags.joinToString(" · ").ifEmpty { "点这里设置群" }, fontSize = 12.sp, color = if (model.online) c.outline else OFFLINE)
                }
            }
        }
        Box(Modifier.fillMaxWidth().size(0.5.dp).background(c.outlineVariant))
    }
}

private fun dayOf(ts: Long): Long = (ts + TimeZone.getDefault().getOffset(ts)) / DateUtils.DAY_IN_MILLIS

private fun sameDay(a: Long, b: Long): Boolean = dayOf(a) == dayOf(b)

// 由旧到新扫一遍, 再整体倒过来交给倒序列表; 本地待发的排在最新
private fun buildRows(messages: List<ServerFrame.Msg>, pending: List<Pending>): List<ChatRow> {
    val rows = ArrayList<ChatRow>(messages.size + pending.size + 8)
    for (i in messages.indices) {
        val m = messages[i]
        val prev = messages.getOrNull(i - 1)
        val newDay = prev == null || !sameDay(prev.ts, m.ts)
        if (newDay) rows.add(ChatRow.Day(m.ts, m.seq))
        val head = newDay || prev!!.src != m.src || m.ts - prev.ts > RUN_GAP_MS
        rows.add(ChatRow.Bubble(m, head))
    }
    pending.forEach { rows.add(ChatRow.Local(it)) }
    rows.reverse()
    return rows
}

@Composable
private fun MessageList(model: ChatModel, group: String, actions: BubbleActions, modifier: Modifier) {
    val g = model.groups
    val messages = g.messages
    val rows = remember(messages.size, messages.firstOrNull()?.seq, messages.lastOrNull()?.seq, g.pending.toList()) {
        buildRows(messages.distinctBy { it.seq }, g.pending.toList())
    }
    val state = rememberLazyListState()
    val showSender = group != MessageDb.MEMO_GROUP
    // 停在底部时新消息自动跟上; 用户往上翻着看就不打扰
    LaunchedEffect(rows.firstOrNull()?.key) {
        if (state.firstVisibleItemIndex <= 1) state.animateScrollToItem(0)
    }
    // 翻到接近最早一条时预取上一页
    val nearTop by remember { derivedStateOf { (state.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) >= state.layoutInfo.totalItemsCount - PREFETCH } }
    LaunchedEffect(nearTop) { if (nearTop) g.loadOlder() }
    var highlight by remember { mutableStateOf<Long?>(null) }
    val latest by rememberUpdatedState(rows)
    LaunchedEffect(Unit) {
        snapshotFlow { g.jump }.collect { seq ->
            if (seq == null) return@collect
            val idx = latest.indexOfFirst { it is ChatRow.Bubble && it.msg.seq == seq }
            if (idx >= 0) state.animateScrollToItem(idx)
            highlight = seq
            g.jump = null
            delay(HIGHLIGHT_MS)
            highlight = null
        }
    }
    LazyColumn(modifier.fillMaxWidth(), state, reverseLayout = true, contentPadding = PaddingValues(horizontal = 8.dp, vertical = 8.dp)) {
        items(rows.size, key = { rows[it].key }, contentType = { rows[it]::class.hashCode() }) { i ->
            val mod = Modifier.animateItem()
            when (val row = rows[i]) {
                is ChatRow.Day -> DayChip(row.ts, mod)
                is ChatRow.Bubble -> MessageBubble(
                    row.msg,
                    model.isMine(row.msg),
                    BubbleSpot(row.head, showSender, highlight == row.msg.seq),
                    actions,
                    mod,
                )
                is ChatRow.Local -> {
                    val p = row.p
                    MessageBubble(
                        ServerFrame.Msg(-1, p.ts, model.device, p.text, p.cid, group, p.reply),
                        true,
                        BubbleSpot(head = true, showSender = false, highlight = false),
                        null,
                        mod,
                        status = when {
                            p.progress != null -> "上传中 ${(p.progress * PCT_SCALE).toInt()}%"
                            p.failed -> (p.error?.let { "$it, " } ?: "发送失败, ") + "点击重发"
                            else -> "发送中"
                        },
                        onStatus = if (p.failed) ({ g.retry(p) }) else null,
                    )
                }
            }
        }
    }
}

private const val PCT_SCALE = 100

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

@Composable
private fun Composer(g: ChatGroups) {
    val c = MaterialTheme.colorScheme
    var text by remember { mutableStateOf("") }
    Column {
        g.replyTo?.let { r ->
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.width(3.dp).size(3.dp, 32.dp).background(c.primary, PILL))
                Column(Modifier.padding(start = 8.dp).weight(1f)) {
                    Text("回复 ${r.src}", fontSize = 12.sp, color = c.primary, fontWeight = FontWeight.SemiBold, maxLines = 1)
                    Text(plainPreview(r.text), fontSize = 12.sp, color = c.outline, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Text("✕", Modifier.clickable { g.replyTo = null }.padding(8.dp), color = c.outline)
            }
        }
        // 附件: 选中就上传, 输入框里的字作为说明一起发
        val pick = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.GetContent()) { uri ->
            if (uri != null) {
                g.sendFile(uri, text)
                text = ""
            }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.Bottom) {
            Box(Modifier.padding(end = 6.dp).size(42.dp).clickable { pick.launch("*/*") }, contentAlignment = Alignment.Center) {
                Text("+", fontSize = 26.sp, color = c.outline)
            }
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
                    .clickable(enabled = ready) { if (g.send(text)) text = "" },
                contentAlignment = Alignment.Center,
            ) {
                Icon("send", if (ready) c.onPrimary else c.outline, 20.dp)
            }
        }
    }
}

/** 选一个群转发过去。 */
@Composable
internal fun ForwardDialog(model: ChatModel, msg: ServerFrame.Msg, close: () -> Unit) {
    val g = model.groups
    val rows = remember { g.rows() }
    AlertDialog(
        onDismissRequest = close,
        title = { Text("转发到") },
        text = {
            LazyColumn {
                items(rows.size) { i ->
                    val r = rows[i]
                    Row(
                        Modifier.fillMaxWidth().clickable { g.forward(msg, r.key); close() }.padding(vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        ChatAvatar(r.key, r.meta?.avatar, 32.dp)
                        Text(r.meta?.title ?: r.key, Modifier.padding(start = 10.dp), maxLines = 1)
                    }
                }
            }
        },
        confirmButton = { TextButton(close) { Text("取消") } },
    )
}
