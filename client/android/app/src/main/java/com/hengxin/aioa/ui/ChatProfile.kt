package com.hengxin.aioa.ui

import android.text.format.DateFormat
import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.data.Me
import com.hengxin.aioa.data.MessageDb
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.HxButton
import com.hengxin.aioa.kit.HxButtonVariant
import com.hengxin.aioa.kit.LiveDot
import com.hengxin.aioa.kit.SoftTag
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.hxPalette
import com.hengxin.aioa.proto.ServerFrame
import com.hengxin.aioa.ui.agents.AgentState
import com.hengxin.aioa.ui.agents.ago
import com.hengxin.aioa.ui.agents.runInfo
import com.hengxin.aioa.ui.agents.stateOf
import com.hengxin.aioa.ui.agents.until
import com.hengxin.aioa.Constants
import com.hengxin.aioa.ui.chat.ChatAgent
import com.hengxin.aioa.ui.chat.ChatMeta
import com.hengxin.aioa.ui.chat.ComposerState
import com.hengxin.aioa.ui.chat.MentionOps
import com.hengxin.aioa.ui.chat.MentionTarget
import com.hengxin.aioa.ui.chat.Names
import com.hengxin.aioa.ui.chat.KickDialog
import com.hengxin.aioa.ui.chat.ROLE_ADMIN
import com.hengxin.aioa.ui.chat.ROLE_MEMBER
import com.hengxin.aioa.ui.chat.ROLE_OWNER
import com.hengxin.aioa.ui.chat.RoomApi
import com.hengxin.aioa.ui.chat.RoomMember
import com.hengxin.aioa.ui.chat.SenderFace
import com.hengxin.aioa.ui.chat.colorOf
import com.hengxin.aioa.ui.chat.joinedDay
import com.hengxin.aioa.ui.chat.openDirect
import kotlinx.coroutines.launch

private const val FACE = 64
private val LABEL_W = 84.dp

/** 消息发送者对应的 @ 目标: Agent 写 agent:<keyId>, 真人写 uid; 系统来源没有。 */
internal fun targetOf(meta: ChatMeta?, members: List<RoomMember>, msg: ServerFrame.Msg): MentionTarget? {
    val sid = msg.sid ?: return null
    meta?.agents?.firstOrNull { it.sourceId == sid }?.let { return MentionOps.agentTarget(it) }
    if (!sid.startsWith(MentionOps.USER_PREFIX)) return null
    val uid = sid.removePrefix(MentionOps.USER_PREFIX)
    val m = members.firstOrNull { it.id == uid }
    return MentionTarget(uid, m?.display?.ifEmpty { null } ?: Names.of(msg), MentionOps.roleLabel(m?.role), sid = sid, avatar = m?.avatar)
}

/**
 * 点头像的资料卡 (#136, 规范 §9): 真人 身份, 群昵称, 最近发言, 共同群, 发消息, @TA, 群主 / 管理员多出设管理员与移出;
 * Agent 状态, 版本, 可读的群, 下次触发, 接入者, @它, Agent 设置。
 * onEditSender 只给主人: Agent 资料卡里多一个 "名字与头像", 打开发送者编辑 (#121, 旧版点头像就能改)。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ProfileSheet(
    model: ChatModel, group: String, msg: ServerFrame.Msg, members: List<RoomMember>, composer: ComposerState,
    onEditSender: (() -> Unit)?, close: () -> Unit,
) {
    val g = model.groups
    val meta = g.directory.metas[group]
    val sid = msg.sid.orEmpty()
    val agent = meta?.agents?.firstOrNull { it.sourceId == sid }
    val target = targetOf(meta, members, msg)
    ModalBottomSheet(close, containerColor = Aioa.colors.popover) {
        Column(Modifier.navigationBarsPadding().padding(horizontal = 18.dp).padding(bottom = 14.dp)) {
            if (agent != null) AgentCard(model, group, agent, members, onEditSender, close) {
                target?.let(composer::mention)
                close()
            } else PersonCard(model, group, msg, members, target, composer, close)
        }
    }
}

@Composable
private fun ColumnScope.PersonCard(model: ChatModel, group: String, msg: ServerFrame.Msg, members: List<RoomMember>, target: MentionTarget?, composer: ComposerState, close: () -> Unit) {
    val c = Aioa.colors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val g = model.groups
    val meta = g.directory.metas[group]
    val uid = msg.sid?.takeIf { it.startsWith(MentionOps.USER_PREFIX) }?.removePrefix(MentionOps.USER_PREFIX)
    val member = members.firstOrNull { it.id == uid }
    val spoke by produceState(0L to 0, group, msg.sid) {
        value = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { MessageDb.get(context).spoke(group, msg.sid.orEmpty()) }
    }
    val name = member?.display?.ifEmpty { null } ?: Names.of(msg)
    // 打开时问一次谁在线 (#130), 不轮询
    val presence = com.hengxin.aioa.ui.chat.PeopleOnline.snapshot()
    val now = com.hengxin.aioa.ui.agents.rememberNow()
    val live = uid != null && (uid == Me.uid || presence.isOnline(uid))
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        SenderFace(msg.sid, name, FACE.dp, avatar = member?.avatar)
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(name, c.text, 20, weight = FontWeight.SemiBold)
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                if (member != null) SoftTag(MentionOps.roleLabel(member.role), c.textSecondary)
                SoftTag("真人", hxPalette().chart3)
                if (live) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) { LiveDot(c.success, 7.dp); Text(ONLINE, c.success, 12) }
            }
            Text(member?.name ?: uid.orEmpty(), c.textSecondary, 13)
        }
    }
    Spacer(Modifier.height(14.dp))
    if (member != null && member.display != member.name) Fact("群昵称", member.display)
    member?.joined?.let(::joinedDay)?.let { Fact("入群", it) }
    if (uid != null) (if (live) ONLINE else presence.label(uid, now))?.let { Fact(ONLINE, it) }
    Fact("最近发言", if (spoke.second == 0) "本机还没有记录" else "${DateFormat.format(TIME_FMT, spoke.first)} · 本群共 ${spoke.second} 条")
    // 共同群 (#139): 打开时问一次服务端, 群名用本机群资料
    val other = uid?.takeIf { it != Me.uid }
    val common by produceState<List<String>?>(null, other) { if (other != null) value = RoomApi(context).commonRooms(other).getOrElse { emptyList() } }
    if (other != null) Fact("共同群", common?.let { l -> if (l.isEmpty()) "没有" else l.joinToString(", ") { g.directory.title(it) } } ?: "正在查...")
    PersonManage(model, group, meta, member, close)
    Row(Modifier.padding(top = 14.dp, bottom = 6.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        if (uid != null && uid != Me.uid && meta?.isDm != true) HxButton("发消息", {
            scope.launch {
                openDirect(context, uid).onSuccess { m ->
                    g.directory.applyChat(m)
                    close()
                    g.openGroup(m.channel)
                }.onFailure { Toast.makeText(context, "没打开单聊: ${it.message}", Toast.LENGTH_SHORT).show() }
            }
        }, Modifier.weight(1f), icon = "message-circle")
        if (target != null && uid != Me.uid && meta?.isDm != true) HxButton("@TA", { composer.mention(target); close() }, Modifier.weight(1f), variant = HxButtonVariant.Secondary, icon = "at-sign")
    }
}

/** 群主 / 管理员对成员: 设管理员 (只有群主), 移出 (先确认); 单聊与自己没有。 */
@Composable
private fun PersonManage(model: ChatModel, group: String, meta: ChatMeta?, member: RoomMember?, close: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    if (member == null || member.id == Me.uid || meta?.shared != true || meta.isDm) return
    val mine = meta.role ?: ROLE_OWNER
    val canRole = mine == ROLE_OWNER && member.role != ROLE_OWNER
    val canKick = canRole || (mine == ROLE_ADMIN && member.role == ROLE_MEMBER)
    if (!canRole && !canKick) return
    var kick by remember { mutableStateOf(false) }
    val api = remember { RoomApi(context.applicationContext) }
    val done: (Result<Unit>) -> Unit = { r ->
        r.onSuccess { model.groups.directory.refreshChats(); close() }
            .onFailure { Toast.makeText(context, "没成功: ${it.message}", Toast.LENGTH_SHORT).show() }
    }
    Row(Modifier.padding(top = 14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        if (canRole) {
            val next = if (member.role == ROLE_ADMIN) ROLE_MEMBER else ROLE_ADMIN
            HxButton(if (next == ROLE_ADMIN) "设为管理员" else "取消管理员", { scope.launch { done(api.setRole(group, member.id, next)) } },
                Modifier.weight(1f), variant = HxButtonVariant.Outline, icon = "shield-check")
        }
        if (canKick) HxButton("移出群", { kick = true }, Modifier.weight(1f), variant = HxButtonVariant.Outline, icon = "ban")
    }
    if (kick) KickDialog(member.display, { kick = false }) { scope.launch { done(api.remove(group, member.id)) } }
}

@Composable
private fun ColumnScope.AgentCard(model: ChatModel, group: String, a: ChatAgent, members: List<RoomMember>, onEditSender: (() -> Unit)?, close: () -> Unit, onAt: () -> Unit) {
    val c = Aioa.colors
    val g = model.groups
    val now = com.hengxin.aioa.ui.agents.rememberNow()
    val tone = colorOf(a.sourceId ?: a.keyId)
    val state = stateOf(a, a.keyId in g.presence.listening(group, now))
    val (label, stateTone) = when (state) {
        AgentState.LISTENING -> "正在监听" to c.success
        AgentState.JOINED -> "已接入" to c.success
        AgentState.PENDING -> "待重新报到" to c.warning
        AgentState.WAITING -> "还没报到" to c.textSecondary
    }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        val name = MentionOps.agentName(a)
        SenderFace(a.sourceId, name, FACE.dp, agent = true)
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(name, c.text, 20, weight = FontWeight.SemiBold)
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { SoftTag(Constants.CLOUD_AGENT, tone); SoftTag(label, stateTone) }
            Text((listOfNotNull(a.client) + a.skills?.skills?.entries?.map { "${it.key} ${it.value}" }.orEmpty()).joinToString(" · ").ifEmpty { "还没上报版本" }, c.textSecondary, 13)
        }
    }
    Spacer(Modifier.height(14.dp))
    val dir = g.directory
    Fact("所在群", dir.title(group))
    Fact("还能读", a.reads.filter { it != group }.joinToString(", ") { dir.title(it) }.ifEmpty { if (group in a.reads) "只有本群" else "只能发, 不能读" })
    Fact("下次触发", runInfo(a, now)?.next?.let { "约 ${until(it, now)}" } ?: "没上报触发方式")
    Fact("最近活跃", a.active?.let { ago(it, now) } ?: "还没有动静")
    // 接入者 (#139): Agent 只能由群主 (主人) 接入, 插件装的写插件
    val owner = members.firstOrNull { it.role == ROLE_OWNER }?.display
    Fact("接入者", a.plugin?.let { "插件 $it" } ?: owner?.let { "$it (群主)" } ?: "群主")
    Row(Modifier.padding(top = 14.dp, bottom = 6.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        HxButton("@它", onAt, Modifier.weight(1f), icon = "at-sign")
        HxButton("${Constants.CLOUD_AGENT} 设置", {
            g.settingsAgent = a.keyId
            close()
            g.page = ChatPage.SETTINGS
        }, Modifier.weight(1f), variant = HxButtonVariant.Secondary, icon = "settings")
    }
    if (onEditSender != null) HxButton("名字与头像", onEditSender, Modifier.fillMaxWidth().padding(bottom = 6.dp), variant = HxButtonVariant.Outline, icon = "image")
}

@Composable
private fun Fact(label: String, value: String) {
    val c = Aioa.colors
    Row(Modifier.fillMaxWidth().padding(vertical = 7.dp)) {
        Text(label, c.textSecondary, 14, Modifier.width(LABEL_W))
        Text(value, c.text, 14, maxLines = 2)
    }
}

private const val TIME_FMT = "MM-dd HH:mm"
private const val ONLINE = "在线"
