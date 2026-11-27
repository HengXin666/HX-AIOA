package com.hengxin.aioa.ui.chat

import com.hengxin.aioa.Constants
import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.data.Me
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.HomeRow
import com.hengxin.aioa.kit.HomeSection
import com.hengxin.aioa.kit.HomeSpace
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.LiveDot
import com.hengxin.aioa.kit.SoftTag
import com.hengxin.aioa.kit.SpaceTabs
import com.hengxin.aioa.kit.hxPalette
import com.hengxin.aioa.ui.ChatModel
import com.hengxin.aioa.ui.agents.AgentsSection
import com.hengxin.aioa.ui.groupinfo.AgentGlyph
import com.hengxin.aioa.ui.groupinfo.GiBar
import com.hengxin.aioa.ui.groupinfo.GiNote
import com.hengxin.aioa.ui.groupinfo.SearchBox
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private const val TAB_MEMBERS = "m"
private const val TAB_AGENTS = "a"
private const val SEARCH_DEBOUNCE_MS = 300L
private const val FACE = 36
private const val MEMBERS = "成员"

fun roleLabel(role: String): String = when (role) {
    ROLE_OWNER -> "群主"
    ROLE_ADMIN -> "管理员"
    else -> MEMBERS
}

/** 成员与 Agent (#137 #130): 两个标签, 搜索走服务端 q, 滚到底加载下一页, 群主 · 管理员与成员分组, 邀请链接。 */
@Composable
fun RoomMembersPage(model: ChatModel, group: String, agentsTab: Boolean, onBack: () -> Unit, openAgent: (String) -> Unit) {
    val dir = model.groups.directory
    val meta = dir.metas[group]
    val context = LocalContext.current.applicationContext
    val api = remember { RoomApi(context) }
    val scope = rememberCoroutineScope()
    val myRole = meta?.role ?: ROLE_OWNER
    val manage = myRole == ROLE_OWNER || myRole == ROLE_ADMIN
    val dm = meta?.isDm == true
    val showAgents = !dm && myRole == ROLE_OWNER
    var tab by rememberSaveable { mutableStateOf(if (agentsTab && showAgents) TAB_AGENTS else TAB_MEMBERS) }
    var q by rememberSaveable { mutableStateOf("") }
    var members by remember { mutableStateOf<List<RoomMember>>(emptyList()) }
    var next by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var invite by remember { mutableStateOf<RoomInvite?>(null) }
    val presence = rememberPresence(group, meta?.shared == true)
    val now = com.hengxin.aioa.ui.agents.rememberNow()
    val apply = { p: MemberPage, more: Boolean -> members = if (more) (members + p.members).distinctBy { it.id } else p.members; next = p.next; error = null }
    val reload: () -> Unit = {
        scope.launch {
            loading = true
            api.page(group, q = q).onSuccess { apply(it, false) }.onFailure { error = it.message }
            loading = false
        }
    }
    val more: () -> Unit = {
        val cur = next
        if (cur != null && !loading) scope.launch {
            loading = true
            api.page(group, cursor = cur, q = q).onSuccess { apply(it, true) }.onFailure { error = it.message }
            loading = false
        }
    }
    LaunchedEffect(group, meta?.updated, q) {
        if (meta?.shared != true) return@LaunchedEffect
        if (q.isBlank()) withContext(Dispatchers.IO) { api.cached(group) }?.let { if (members.isEmpty()) apply(it, false) } else delay(SEARCH_DEBOUNCE_MS)
        reload()
    }
    val act: (suspend () -> Result<Unit>) -> Unit = { call -> scope.launch { call().onSuccess { reload(); dir.refreshChats() }.onFailure { error = it.message } } }
    val doInvite = { scope.launch { api.invite(group).onSuccess { invite = it }.onFailure { error = it.message } }; Unit }
    Column(Modifier.fillMaxSize().background(Aioa.colors.background)) {
        GiBar("成员与${Constants.CLOUD_AGENT}", meta?.title ?: group, onBack, if (manage && !dm) "user-plus" else "", doInvite)
        if (showAgents) {
            SpaceTabs(listOf(HomeSpace(TAB_MEMBERS, MEMBERS, "", badge = meta?.members ?: 0), HomeSpace(TAB_AGENTS, Constants.CLOUD_AGENT, "", badge = meta?.agents?.size ?: 0)), tab, { tab = it })
        }
        val list = rememberLazyListState()
        val atEnd by remember { derivedStateOf { list.layoutInfo.visibleItemsInfo.lastOrNull()?.index == list.layoutInfo.totalItemsCount - 1 } }
        LaunchedEffect(atEnd, next, tab) { if (atEnd && tab == TAB_MEMBERS) more() }
        LazyColumn(Modifier.weight(1f).padding(horizontal = 14.dp), state = list) {
            if (tab == TAB_AGENTS) {
                item { AgentsSection(model, group, meta?.agents.orEmpty(), openAgent) }
                return@LazyColumn
            }
            item { SearchBox(q, "搜索成员") { q = it } }
            error?.let { e -> item { GiNote(e, Aioa.colors.danger) } }
            if (meta?.shared != true) {
                item { HomeSection(MEMBERS, 1) { GiNote("现在只有你自己。生成邀请链接发给别人, 对方注册或登录后就进群; 消息只存一份, 所有人实时收到。") } }
            } else {
                val (heads, rest) = members.partition { it.role == ROLE_OWNER || it.role == ROLE_ADMIN }
                if (heads.isNotEmpty()) item { MemberGroup("群主 · 管理员", heads, myRole, act, group, api, presence, now) }
                if (rest.isNotEmpty()) item { MemberGroup(MEMBERS, rest, myRole, act, group, api, presence, now) }
                if (members.isEmpty() && !loading) item { GiNote(if (q.isBlank()) "还没有成员" else "没找到 \"$q\"") }
                if (next != null || loading) item { GiNote("正在加载...") }
            }
            if (manage && !dm) item {
                HomeSection("邀请") {
                    HomeRow("邀请链接", "生成一条链接发给对方, 注册或登录后进群", lead = { AgentGlyph(Aioa.colors.textSecondary) }, onClick = doInvite,
                        end = { Icon("link", Aioa.colors.textSecondary, 16.dp) })
                }
            }
        }
    }
    invite?.let { InviteDialog(it, meta?.title ?: group) { invite = null } }
}

@Composable
private fun MemberGroup(title: String, list: List<RoomMember>, myRole: String, act: (suspend () -> Result<Unit>) -> Unit, group: String, api: RoomApi, presence: MemberPresence, now: Long) {
    HomeSection(title, list.size) {
        list.forEachIndexed { i, m ->
            MemberRow(m, myRole, i > 0, presence.isOnline(m.id), presence.label(m.id, now), onRole = { role -> act { api.setRole(group, m.id, role) } }, onKick = { act { api.remove(group, m.id) } })
        }
    }
}

@Composable
private fun MemberRow(m: RoomMember, myRole: String, divider: Boolean, live: Boolean, seen: String?, onRole: (String) -> Unit, onKick: () -> Unit) {
    val c = Aioa.colors
    val pal = hxPalette()
    var menu by remember { mutableStateOf(false) }
    val isMe = m.id == Me.uid
    // 群主能改身份和踢任何人; 管理员只能踢普通成员
    val canRole = myRole == ROLE_OWNER && m.role != ROLE_OWNER
    val canKick = !isMe && (canRole || (myRole == ROLE_ADMIN && m.role == ROLE_MEMBER))
    // 在线的头像带绿点, 不在线的行尾写最近在线 (#130)
    val online = m.online || isMe || live
    Box {
        HomeRow(
            if (isMe) "${m.display} (我)" else m.display, "@${m.name}", trail = if (online) "" else seen.orEmpty(), divider = divider,
            lead = {
                Box {
                    ChatAvatar(m.display, m.avatar, FACE.dp)
                    if (online) Box(Modifier.align(Alignment.BottomEnd)) { LiveDot(c.success, 6.dp) }
                }
            },
            end = { if (m.role != ROLE_MEMBER) SoftTag(roleLabel(m.role), if (m.role == ROLE_OWNER) c.warning else pal.chart2) },
            onClick = { if (canRole || canKick) menu = true },
        )
        DropdownMenu(menu, { menu = false }) {
            if (canRole) {
                val next = if (m.role == ROLE_ADMIN) ROLE_MEMBER else ROLE_ADMIN
                DropdownMenuItem({ Text(if (next == ROLE_ADMIN) "设为管理员" else "取消管理员") }, { menu = false; onRole(next) })
            }
            if (canKick) DropdownMenuItem({ Text("移出群", color = MaterialTheme.colorScheme.error) }, { menu = false; onKick() })
        }
    }
}

/** 邀请链接: 分享或复制。 */
@Composable
fun InviteDialog(inv: RoomInvite, title: String, close: () -> Unit) {
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val c = Aioa.colors
    AlertDialog(
        onDismissRequest = close,
        title = { Text("邀请链接") },
        text = {
            Column {
                Text("发给要邀请的人: 浏览器打开能拉起 App, 没装的按页面提示下载后用邀请码注册。${expiry(inv.expires)}", color = c.textSecondary)
                SelectionContainer(Modifier.padding(top = 8.dp)) { Text(inv.link) }
            }
        },
        confirmButton = {
            TextButton({
                val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "邀请你加入群 \"$title\": ${inv.link}")
                context.startActivity(Intent.createChooser(send, "分享邀请").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                close()
            }) { Text("分享") }
        },
        dismissButton = { TextButton({ clipboard.setText(AnnotatedString(inv.link)); close() }) { Text("复制链接") } },
    )
}

private fun expiry(ts: Long): String = if (ts <= 0) "" else " ${SimpleDateFormat("MM-dd HH:mm", Locale.CHINA).format(Date(ts))} 前有效。"
