package com.hengxin.aioa.ui

import com.hengxin.aioa.Constants
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.data.Me
import com.hengxin.aioa.data.MessageDb
import com.hengxin.aioa.kit.HomeSection
import com.hengxin.aioa.kit.enter
import com.hengxin.aioa.net.ErrKind
import com.hengxin.aioa.ui.agents.AgentSettingsPage
import com.hengxin.aioa.ui.agents.AgentsSection
import com.hengxin.aioa.ui.chat.AvatarUploads
import com.hengxin.aioa.ui.chat.InviteDialog
import com.hengxin.aioa.ui.chat.ROLE_ADMIN
import com.hengxin.aioa.ui.chat.ROLE_OWNER
import com.hengxin.aioa.ui.chat.RoomApi
import com.hengxin.aioa.ui.chat.RoomInvite
import com.hengxin.aioa.ui.chat.RoomMembersPage
import com.hengxin.aioa.ui.chat.digestLabel
import com.hengxin.aioa.ui.chat.rememberAvatarPicker
import com.hengxin.aioa.ui.groupinfo.GiDanger
import com.hengxin.aioa.ui.groupinfo.GiPage
import com.hengxin.aioa.ui.groupinfo.GiToggle
import com.hengxin.aioa.ui.groupinfo.GiValue
import com.hengxin.aioa.ui.groupinfo.GroupHead
import com.hengxin.aioa.ui.groupinfo.GroupPicksPage
import com.hengxin.aioa.ui.groupinfo.GroupSearchPage
import com.hengxin.aioa.ui.groupinfo.GsDialog
import com.hengxin.aioa.ui.groupinfo.GsDialogs
import com.hengxin.aioa.ui.groupinfo.GsPage
import com.hengxin.aioa.ui.groupinfo.GsStack
import com.hengxin.aioa.ui.groupinfo.MemberStrip
import com.hengxin.aioa.ui.groupinfo.Quick
import com.hengxin.aioa.ui.groupinfo.viewLabel
import kotlinx.coroutines.launch

private const val AVATAR_FAIL = "头像上传失败: "

/** 群聊设置 (#137): 子页 (成员, Agent 设置, 查找, 群文件, 精选) 叠在这一页里, 返回逐级退。 */
@Composable
fun GroupSettingsPage(model: ChatModel, group: String, onBack: () -> Unit) {
    var stack by remember(group) { mutableStateOf(GsStack()) }
    BackHandler(enabled = stack.canBack) { stack = stack.pop() }
    val push: (GsPage) -> Unit = { stack = stack.push(it) }
    val pop: () -> Unit = { stack = stack.pop() }
    // 资料卡上的 "Agent 设置" (#136) 先记下 keyId 再打开群设置: 直接叠上 Agent 设置, 返回回群设置
    val wanted = model.groups.settingsAgent
    LaunchedEffect(wanted) {
        if (wanted != null) {
            stack = GsStack().push(GsPage.Agent(wanted))
            model.groups.settingsAgent = null
        }
    }
    when (val top = stack.top) {
        null -> GroupInfoRoot(model, group, onBack, push)
        is GsPage.Members -> RoomMembersPage(model, group, top.agents, pop) { push(GsPage.Agent(it)) }
        is GsPage.Agent -> AgentSettingsPage(model, group, top.keyId, pop)
        GsPage.Search -> GroupSearchPage(model, group, false, pop)
        GsPage.Files -> GroupSearchPage(model, group, true, pop)
        GsPage.Picks -> GroupPicksPage(model, group, pop)
    }
}

@Composable
private fun GroupInfoRoot(model: ChatModel, group: String, onBack: () -> Unit, push: (GsPage) -> Unit) {
    val g = model.groups
    val dir = g.directory
    val meta = dir.metas[group]
    // 只有自己的群没有 role, 主人就是群主; 单聊 (#133) 没有 Agent, 邀请, 成员管理与群类型
    val owner = meta?.role == null || meta.role == ROLE_OWNER
    val manage = owner || meta?.role == ROLE_ADMIN
    val memo = group == MessageDb.MEMO_GROUP
    val dm = meta?.isDm == true
    val context = LocalContext.current
    val api = remember { RoomApi(context.applicationContext) }
    val scope = rememberCoroutineScope()
    var dialog by remember { mutableStateOf<GsDialog?>(null) }
    var busy by remember { mutableStateOf<String?>(null) }
    var invite by remember { mutableStateOf<RoomInvite?>(null) }
    // 上传在应用级作用域里跑 (#125): 离开页面继续, 回来接着看进度; 失败留着裁好的图, 点 "重试" 不用重新选图
    val avatarKey = AvatarUploads.groupKey(group)
    val job = AvatarUploads.jobs[avatarKey]
    val upload = { bytes: ByteArray -> AvatarUploads.start(context, avatarKey, bytes) { id -> dir.saveAvatar(group, id) } }
    val pickAvatar = rememberAvatarPicker({ dir.error = it }) { upload(it) }
    LaunchedEffect(job?.done, meta?.avatar) { if (job?.done != null && job.done == meta?.avatar) AvatarUploads.clear(avatarKey) }
    val doInvite = { scope.launch { api.invite(group).onSuccess { invite = it }.onFailure { dir.error = it.message } }; Unit }
    GiPage(if (dm) "聊天设置" else "群聊设置", busy.orEmpty(), onBack) {
        GroupHead(model, group, meta, job, manage && job?.running != true, pickAvatar, Modifier.padding(top = 14.dp).enter(0))
        job?.error?.let { e ->
            ErrorNote("$AVATAR_FAIL$e", Modifier.padding(top = 8.dp), kind = job.kind ?: ErrKind.guess(e), onRetry = { upload(job.bytes) }, onDismiss = { AvatarUploads.clear(avatarKey) })
        }
        dir.error?.let { e -> ErrorNote(e, Modifier.padding(top = 8.dp), onDismiss = { dir.error = null }) }
        if (!memo) MemberStrip(group, meta, manage && !dm, { push(GsPage.Members()) }, doInvite, Modifier.enter(1))
        if (owner && !memo && !dm) Column(Modifier.enter(2)) { AgentsSection(model, group, meta?.agents.orEmpty()) { push(GsPage.Agent(it)) } }
        Row(Modifier.padding(top = 18.dp).enter(3), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Quick("search", "查找记录", Modifier.weight(1f)) { push(GsPage.Search) }
            Quick("folder", "群文件", Modifier.weight(1f)) { push(GsPage.Files) }
            Quick("star", "收藏", Modifier.weight(1f)) { g.favoritesOpen = true }
            Quick("sparkles", "精选", Modifier.weight(1f)) { push(GsPage.Picks) }
        }
        Column(Modifier.enter(4)) {
            HomeSection("资料") {
                GiValue(if (dm) "备注名" else "群名称", meta?.title ?: group, false, if (manage) { { dialog = GsDialog.Rename } } else null)
                if (!dm && !memo) GiValue("群公告", meta?.notice?.lineSequence()?.firstOrNull().orEmpty().ifEmpty { "未设置" }, true) { dialog = GsDialog.Notice(manage) }
                if (!memo) GiValue("所属域", g.folderOf(group) ?: "不在域里", true) { dialog = GsDialog.Folder }
                if (owner && !dm) GiValue("群类型", digestLabel(meta?.digest) ?: "普通", true) { dialog = GsDialog.Digest }
                val canView = owner && meta?.isMail != true && !memo && !dm
                GiValue("展示方式", viewLabel(meta), true, if (canView) { { dialog = GsDialog.View } } else null)
                if (owner && meta?.isFeed == true) GiValue("信息流标签", "${meta.tags.size} 个" + if (meta.feedTags.isEmpty()) " (默认)" else "", true) { dialog = GsDialog.Tags }
            }
            HomeSection("提醒") {
                GiToggle("置顶", meta?.pinned == true, false) { dir.setPinned(group, it) }
                GiToggle("免打扰", meta?.muted == true, true, "照常收消息, 只是不响铃不弹通知") { dir.setMuted(group, it) }
                // 实时状态提示: 群主 / 管理员可关, 关了服务端不再推这类帧
                if (!memo && (meta?.canTune ?: true)) {
                    GiToggle("显示 \"正在输入\"", meta?.hideTyping != true, true) { dir.setHideTyping(group, !it) }
                    if (!dm) GiToggle("显示${Constants.CLOUD_AGENT} 正在监听", meta?.hideListening != true, true) { dir.setHideListening(group, !it) }
                }
            }
            val leave = meta?.shared == true && meta.role != ROLE_OWNER
            if (owner || leave) HomeSection("") {
                if (owner) GiDanger("清空聊天记录", false) { dialog = GsDialog.Clear }
                if (owner && !memo) GiDanger("删除群", true) { dialog = GsDialog.Delete }
                if (leave) GiDanger(if (dm) "删除单聊" else "退出群", owner) { dialog = GsDialog.Leave }
            }
        }
    }
    invite?.let { InviteDialog(it, meta?.title ?: group) { invite = null } }
    GsDialogs(g, group, meta, dialog, { dialog = null }, onClear = {
        busy = "正在清空..."
        g.clearHistory(group) { err -> busy = null; err?.let { dir.error = "清空失败: $it" } }
    }) {
        val me = Me.uid ?: return@GsDialogs
        scope.launch { api.remove(group, me).onSuccess { dir.refreshChats(); onBack() }.onFailure { dir.error = it.message } }
    }
}
