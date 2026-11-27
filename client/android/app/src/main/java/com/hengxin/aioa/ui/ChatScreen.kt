package com.hengxin.aioa.ui

import android.text.format.DateUtils
import androidx.activity.compose.BackHandler
import com.hengxin.aioa.ui.feed.FeedView
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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.saveable.rememberSaveable
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
import com.hengxin.aioa.data.Me
import com.hengxin.aioa.data.MessageDb
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.proto.ServerFrame
import com.hengxin.aioa.ui.chat.NewMessagesChip
import com.hengxin.aioa.ui.chat.sendIn
import com.hengxin.aioa.ui.chat.MailView
import com.hengxin.aioa.ui.chat.ComposerState
import com.hengxin.aioa.ui.chat.MentionOps
import com.hengxin.aioa.ui.chat.RoomApi
import com.hengxin.aioa.ui.chat.RoomMember
import com.hengxin.aioa.ui.chat.SubBar
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.TimeZone

internal val PAD = 12.dp
private val ONLINE = Color(0xFF34C759)
private val OFFLINE = Color(0xFFFF9500)
private val PILL = RoundedCornerShape(50)
private const val BACK_ROTATE = 90f
// 同一个人连续发且间隔不超过这个时间, 合并成一串, 只在第一条显示名字与头像
private const val RUN_GAP_MS = 3 * 60_000L
// 离最早一条还剩几项时开始翻上一页
private const val PREFETCH = 15
private const val HIGHLIGHT_MS = 1600L
// 离底部几行以内算 "在底部"
private const val BOTTOM_SLACK = 1

// 列表项; 列表倒序排放 (最新在最下, 但索引 0 是最新), 这样新消息进来不用滚动, 也自带动画
private sealed interface ChatRow {
    val key: String

    data class Day(val ts: Long, val seq: Long) : ChatRow {
        override val key get() = "d$seq"
    }

    data class Bubble(val msg: ServerFrame.Msg, val head: Boolean) : ChatRow {
        // 自己发的按 cid 作键, 和发送中的那行同一个键, 回执到了原地替换, 不闪
        override val key get() = if (msg.mine && msg.cid != null) "c${msg.cid}" else "m${msg.seq}"
    }

    data class Local(val p: Pending) : ChatRow {
        override val key get() = "c${p.cid}"
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
    val picking = remember(open) { Picking() }
    BackHandler(enabled = picking.on) { picking.stop() }
    var forwarding by remember { mutableStateOf<ServerFrame.Msg?>(null) }
    // 真人与群 Agent 点头像出资料卡 (#136), 主人在 Agent 资料卡里改名换头像; 主人点其它非真人发送者的头像直接改 (#123 #128 #121)
    var sender by remember { mutableStateOf<ServerFrame.Msg?>(null) }
    var profile by remember { mutableStateOf<ServerFrame.Msg?>(null) }
    // 点开的合并转发卡片 (整条消息, 取详情时带它的 seq 作 via)
    var bundle by remember { mutableStateOf<ServerFrame.Msg?>(null) }
    val context = androidx.compose.ui.platform.LocalContext.current
    val isOwner = remember { com.hengxin.aioa.config.Auth.load(context)?.role == com.hengxin.aioa.ui.chat.ROLE_OWNER }
    val dir = g.directory
    val meta = dir.metas[open]
    val composer = remember(open) { ComposerState() }
    val members by androidx.compose.runtime.produceState(emptyList<RoomMember>(), open, meta?.shared) {
        if (meta?.shared == true) value = RoomApi(context).members(open).getOrNull().orEmpty()
    }
    val candidates = remember(meta, members) { MentionOps.candidates(meta, members, Me.uid) }
    val atNames = remember(candidates) { MentionOps.names(candidates) }
    val roles = remember(members) { members.associate { MentionOps.USER_PREFIX + it.id to MentionOps.roleLabel(it.role) } }
    val faces = remember(members) { members.mapNotNull { m -> m.avatar?.let { MentionOps.USER_PREFIX + m.id to it } }.toMap() }
    val agentSids = meta?.agents?.mapNotNull { it.sourceId }?.toSet().orEmpty()
    val actions = BubbleActions(
        onReply = { g.replyTo = it },
        onForward = { forwarding = it },
        onFavorite = dir::toggleFavorite,
        isFavorite = dir::isFavorite,
        digests = dir.digests().filter { it.channel != open }.map { it.channel to (it.title ?: it.channel) },
        onDigest = { m, key -> g.forward(m, key) },
        onJump = g::jumpTo,
        onRemove = g::remove,
        onAvatar = { m ->
            when {
                targetOf(meta, members, m) != null -> profile = m
                isOwner && m.sid?.startsWith(MentionOps.USER_PREFIX) == false -> sender = m
            }
        },
        onAvatarLong = { m -> targetOf(meta, members, m)?.let(composer::mention) },
        onSelect = { m -> if (picking.on) picking.toggle(m.seq) else picking.start(m.seq) },
        onBundle = { m -> if (m.bundle != null) bundle = m },
        admin = meta?.canManage == true,
        look = { m -> SenderLook(roles[m.sid], m.sid in agentSids || com.hengxin.aioa.ui.chat.Names.isAgent(m.sid), faces[m.sid]) },
        atNames = atNames,
    )
    CompositionLocalProvider(com.hengxin.aioa.ui.feed.LocalFeedTags provides (meta?.tags ?: com.hengxin.aioa.ui.feed.DEFAULT_TAGS)) { Column(Modifier.fillMaxSize().imePadding()) {
        if (picking.on) SubBar("已选 ${picking.seqs?.size ?: 0} 条", "", { picking.stop() }, right = null, back = "x")
        else RoomBar(model, open) { g.close() }
        val err = g.error ?: dir.error
        if (err != null) ErrorNote(err, Modifier.fillMaxWidth().padding(horizontal = PAD, vertical = 4.dp), onDismiss = { g.clearError() })
        // 进群设置再回来时停在原来的位置; 换群或退出群后是新的一页
        if (meta?.isMail == true) {
            KeepState("chat:mail:${g.visit}") { MailView(g.messages.lastOrNull()?.seq, Modifier.weight(1f)) }
        } else if (meta?.isFeed == true) {
            KeepState("chat:feed:$open:${g.visit}") { FeedView(g.messages, Modifier.weight(1f)) }
        } else {
            // 装了待办插件的群: 顶上切 聊天 / 待办
            var todo by rememberSaveable(open) { mutableStateOf(false) }
            if (meta?.agents?.any { it.plugin in TODO_PLUGINS } == true) com.hengxin.aioa.ui.todo.ChatTodoTabs(todo) { todo = it }
            if (todo) KeepState("chat:todo:$open") {
                // 看 "全部待办" 时来源消息可能在别的群: 本群就地定位, 别的群进去再定位
                com.hengxin.aioa.ui.todo.TodoBoard(model.spaces, open, { ch, seq -> todo = false; if (ch == open) g.jumpTo(seq) else model.groups.openAt(ch, seq) }, Modifier.weight(1f))
            }
            else {
                KeepState("chat:msg:$open:${g.visit}") { MessageList(model, open, actions, picking, Modifier.weight(1f)) }
                if (picking.on) SelectBar(model, open, picking)
                else ChatComposer(
                    g, composer, candidates, if (meta?.isDm == true) "发消息" else "发消息, 输入 @ 叫人或 Agent",
                    listOf(
                        "list-checks" to ("多选" to { picking.start(null) }),
                        "star" to ("收藏" to { g.favoritesOpen = true }),
                        "settings" to ((if (meta?.isDm == true) "聊天设置" else "群设置") to { g.page = ChatPage.SETTINGS }),
                    ),
                )
            }
        }
    } }
    forwarding?.let { m -> ForwardDialog(model, m) { forwarding = null } }
    profile?.let { m -> ProfileSheet(model, open, m, members, composer, if (isOwner) ({ profile = null; sender = m }) else null) { profile = null } }
    bundle?.let { m -> m.bundle?.let { b -> com.hengxin.aioa.ui.chat.BundleView(b, m.seq) { bundle = null } } }
    sender?.let { m -> com.hengxin.aioa.ui.chat.SenderEditSheet(m.sid.orEmpty(), com.hengxin.aioa.ui.chat.Names.of(m), dir) { sender = null } }
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

// 待办插件迁移后群里 Agent 的 plugin 是新 id, 没升级的服务端仍是旧 id
private val TODO_PLUGINS = setOf(com.hengxin.aioa.Constants.TODO_PLUGIN, "todo")

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
    // 回执和本地那行同时存在的一瞬间只留回执, 免得键重复
    val sent = messages.mapNotNullTo(HashSet()) { it.cid }
    pending.forEach { if (it.cid !in sent) rows.add(ChatRow.Local(it)) }
    rows.reverse()
    return rows
}

@Composable
private fun MessageList(model: ChatModel, group: String, actions: BubbleActions, picking: Picking, modifier: Modifier) {
    val g = model.groups
    val messages = g.messages
    val rows = remember(messages.size, messages.firstOrNull()?.seq, messages.lastOrNull()?.seq, g.pending.toList()) {
        buildRows(messages.distinctBy { it.seq }, g.pending.toList())
    }
    val state = rememberLazyListState()
    val showSender = group != MessageDb.MEMO_GROUP
    // 停在底部时新消息自动跟上; 用户往上翻着看就不打扰, 只计数并显示 "新消息" 小条
    val atBottom by remember { derivedStateOf { state.firstVisibleItemIndex <= BOTTOM_SLACK } }
    var unseen by remember(group) { mutableStateOf(0) }
    LaunchedEffect(rows.firstOrNull()?.key) {
        if (atBottom) state.animateScrollToItem(0) else if ((rows.firstOrNull() as? ChatRow.Bubble)?.msg?.mine == false) unseen++
    }
    LaunchedEffect(atBottom) { if (atBottom) unseen = 0 }
    // 自己发消息: 不管翻到哪都回到底部
    LaunchedEffect(g.sendTick) { if (g.sendTick > 0) state.animateScrollToItem(0) }
    val scope = rememberCoroutineScope()
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
    val todoGroup = model.groups.directory.metas[group]?.agents?.any { it.plugin in TODO_PLUGINS } == true
    Box(modifier.fillMaxWidth()) {
    LazyColumn(Modifier.fillMaxSize(), state, reverseLayout = true, contentPadding = PaddingValues(horizontal = 8.dp, vertical = 8.dp)) {
        items(rows.size, key = { rows[it].key }, contentType = { rows[it]::class.hashCode() }) { i ->
            val mod = Modifier.animateItem()
            when (val row = rows[i]) {
                is ChatRow.Day -> DayChip(row.ts, mod)
                is ChatRow.Bubble -> Column(mod) {
                    val mine = model.isMine(row.msg)
                    MessageBubble(row.msg, mine, BubbleSpot(row.head, showSender, highlight == row.msg.seq, picking.on, picking.seqs?.contains(row.msg.seq) == true), actions, Modifier)
                    // 待办群: 消息下面挂它生出来的待办, 点开看详情 (#122)
                    if (todoGroup) com.hengxin.aioa.ui.todo.TodoChips(model.spaces, group, row.msg.seq, mine) { seq -> g.jumpTo(seq) }
                }
                is ChatRow.Local -> {
                    val p = row.p
                    MessageBubble(
                        ServerFrame.Msg(-1, p.ts, Me.label, p.text, p.cid, group, p.reply, mine = true, mentions = p.mentions),
                        true,
                        BubbleSpot(head = true, showSender = false, highlight = false),
                        null,
                        mod.sendIn(),
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
    if (unseen > 0 && !atBottom) {
        NewMessagesChip(unseen, Modifier.align(Alignment.BottomEnd).padding(12.dp)) {
            unseen = 0
            scope.launch { state.animateScrollToItem(0) }
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
