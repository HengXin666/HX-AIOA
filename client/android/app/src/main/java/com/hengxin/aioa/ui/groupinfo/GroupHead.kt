package com.hengxin.aioa.ui.groupinfo

import com.hengxin.aioa.Constants
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.data.Me
import com.hengxin.aioa.data.MessageDb
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.LiveDot
import com.hengxin.aioa.kit.Panel
import com.hengxin.aioa.kit.SectionTitle
import com.hengxin.aioa.kit.SoftTag
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.hxPalette
import com.hengxin.aioa.kit.pointerTap
import com.hengxin.aioa.ui.ChatModel
import com.hengxin.aioa.ui.chat.AvatarJob
import com.hengxin.aioa.ui.chat.ChatAvatar
import com.hengxin.aioa.ui.chat.ChatMeta
import com.hengxin.aioa.ui.chat.RoomApi
import com.hengxin.aioa.ui.chat.RoomMember
import com.hengxin.aioa.ui.chat.UploadingAvatar
import com.hengxin.aioa.ui.chat.digestLabel
import com.hengxin.aioa.ui.chat.PeopleOnline
import com.hengxin.aioa.ui.chat.roleLabel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.Calendar

private val BIG = 64.dp
private val FACE = 52.dp
private const val STRIP = 10
// 今日消息从本地库最近这么多条里数, 够一个群一天用
private const val TODAY_SCAN = 2000

fun viewLabel(meta: ChatMeta?): String = when {
    meta?.isMail == true -> "邮件"
    meta?.isFeed == true -> "信息流"
    else -> "聊天"
}

/** 头部: 头像 (可换), 名字, channel, 域 / 群类型标签; 下面三个计数 (都来自缓存与本地库, 打开不请求)。 */
@Composable
internal fun GroupHead(model: ChatModel, group: String, meta: ChatMeta?, job: AvatarJob?, canAvatar: Boolean, pickAvatar: () -> Unit, modifier: Modifier) {
    val c = Aioa.colors
    val pal = hxPalette()
    val g = model.groups
    val dm = meta?.isDm == true
    val today = rememberToday(group, model.messages.size)
    Panel(modifier.fillMaxWidth()) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            UploadingAvatar(job, BIG, Modifier.pointerTap { if (canAvatar) pickAvatar() }) { ChatAvatar(group, job?.done ?: meta?.avatar, BIG) }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(meta?.title ?: group, c.text, 20, weight = FontWeight.SemiBold)
                Text(if (canAvatar) "$group · 点头像更换" else group, c.textSecondary, 13)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (dm) SoftTag("单聊", pal.chart3)
                    g.folderOf(group)?.let { SoftTag("$it 域", pal.chart2) }
                    digestLabel(meta?.digest)?.let { SoftTag(it, pal.chart3) }
                    if (meta?.isFeed == true || meta?.isMail == true) SoftTag(viewLabel(meta), pal.chart4)
                }
            }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.border.copy(alpha = LINE_ALPHA)))
        Row(Modifier.padding(vertical = 12.dp)) {
            GiStat(if (meta?.shared == true) meta.members else 1, "成员", Modifier.weight(1f))
            if (!dm) GiStat(meta?.agents?.size ?: 0, Constants.CLOUD_AGENT, Modifier.weight(1f))
            GiStat(today, "今日消息", Modifier.weight(1f))
        }
    }
}

@Composable
private fun rememberToday(group: String, tick: Int): Int {
    val db = MessageDb.get(LocalContext.current)
    val n by produceState(0, group, tick) {
        val start = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
        }.timeInMillis
        value = withContext(Dispatchers.IO) { db.inGroup(group, TODAY_SCAN).count { it.ts >= start } }
    }
    return n
}

/** 群成员横排: 前 10 个 (先显示缓存, 再带 ETag 问服务端) + 邀请; 点 "全部" 进成员页。 */
@Composable
internal fun MemberStrip(group: String, meta: ChatMeta?, canInvite: Boolean, onAll: () -> Unit, onInvite: () -> Unit, modifier: Modifier) {
    val c = Aioa.colors
    val context = LocalContext.current.applicationContext
    val api = remember { RoomApi(context) }
    var list by remember(group) { mutableStateOf<List<RoomMember>>(emptyList()) }
    LaunchedEffect(group, meta?.updated, meta?.shared) {
        if (meta?.shared != true) return@LaunchedEffect
        withContext(Dispatchers.IO) { api.cached(group) }?.let { list = it.members }
        // 和成员页同一份第一页缓存 (同样的 limit, ETag 才对得上)
        api.page(group).onSuccess { list = it.members }
    }
    val presence = PeopleOnline.snapshot()
    val shown = if (meta?.shared == true) list.take(STRIP) else listOfNotNull(Me.uid?.let { RoomMember(it, it, "我", com.hengxin.aioa.ui.chat.ROLE_OWNER) })
    Column(modifier) {
        SectionTitle("群成员", if (meta?.shared == true) meta.members else shown.size, action = "全部", onAction = onAll)
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            shown.forEach { m ->
                Column(Modifier.width(60.dp).pointerTap(onAll), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Box {
                        ChatAvatar(m.display, m.avatar, FACE)
                        if (m.id == Me.uid || presence.isOnline(m.id)) Box(Modifier.align(Alignment.BottomEnd)) { LiveDot(c.success, 8.dp) }
                    }
                    Text(if (m.id == Me.uid) "我" else m.display, c.text, 12)
                    if (m.role.isNotEmpty() && m.role != com.hengxin.aioa.ui.chat.ROLE_MEMBER) Text(roleLabel(m.role), c.textSecondary, 10)
                }
            }
            if (canInvite) InviteTile(onInvite)
        }
    }
}
