package com.hengxin.aioa.ui.chat

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.data.Me
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private val BOX = RoundedCornerShape(10.dp)

fun roleLabel(role: String): String = when (role) {
    ROLE_OWNER -> "群主"
    ROLE_ADMIN -> "管理员"
    else -> "成员"
}

/** 群设置里的成员卡: 成员列表, 邀请链接, 设管理员, 踢人, 退群。meta 为空或 role 为空表示只有自己的群, 主人就是群主。 */
@Composable
fun MembersCard(group: String, meta: ChatMeta?, onChanged: () -> Unit, onLeft: () -> Unit) {
    val context = LocalContext.current.applicationContext
    val api = remember { RoomApi(context) }
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    val c = MaterialTheme.colorScheme
    val myRole = meta?.role ?: ROLE_OWNER
    val manage = myRole == ROLE_OWNER || myRole == ROLE_ADMIN
    var members by remember { mutableStateOf<List<RoomMember>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    var invite by remember { mutableStateOf<RoomInvite?>(null) }
    var leaving by remember { mutableStateOf(false) }
    val reload: () -> Unit = { scope.launch { api.members(group).onSuccess { members = it; error = null }.onFailure { error = it.message } } }
    LaunchedEffect(group, meta?.updated) { if (meta?.shared == true) reload() }
    val act: (suspend () -> Result<Unit>) -> Unit = { call ->
        scope.launch { call().onSuccess { reload(); onChanged() }.onFailure { error = it.message } }
    }

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(if (meta?.shared == true) "成员 (${meta.members})" else "成员", Modifier.weight(1f), fontSize = 15.sp)
            if (manage) TextButton({ scope.launch { api.invite(group).onSuccess { invite = it }.onFailure { error = it.message } } }) { Text("+ 邀请") }
        }
        if (meta?.shared != true) Text("现在只有你自己。生成邀请链接发给别人, 对方注册或登录后就进群; 消息只存一份, 所有人实时收到。", fontSize = 12.sp, color = c.outline)
        error?.let { Text(it, fontSize = 12.sp, color = c.error) }
        members.forEach { m -> MemberRow(m, myRole, onRole = { role -> act { api.setRole(group, m.id, role) } }, onKick = { act { api.remove(group, m.id) } }) }
        if (meta?.shared == true && myRole != ROLE_OWNER) {
            Row(Modifier.fillMaxWidth().clickable { leaving = true }.padding(vertical = 8.dp)) { Text("退出群", fontSize = 15.sp, color = c.error) }
        }
    }

    invite?.let { inv ->
        AlertDialog(
            onDismissRequest = { invite = null },
            title = { Text("邀请链接") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("发给要邀请的人: 浏览器打开能拉起 App, 没装的按页面提示下载后用邀请码注册。${expiry(inv.expires)}", fontSize = 12.sp, color = c.outline)
                    Box(Modifier.background(c.surfaceVariant, BOX).padding(10.dp)) { SelectionContainer { Text(inv.link, fontSize = 13.sp) } }
                }
            },
            confirmButton = {
                TextButton({
                    val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "邀请你加入群 \"${meta?.title ?: group}\": ${inv.link}")
                    context.startActivity(Intent.createChooser(send, "分享邀请").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    invite = null
                }) { Text("分享") }
            },
            dismissButton = { TextButton({ clipboard.setText(AnnotatedString(inv.link)); invite = null }) { Text("复制链接") } },
        )
    }
    if (leaving) {
        AlertDialog(
            onDismissRequest = { leaving = false },
            title = { Text("退出这个群?") },
            text = { Text("退出后收不到这个群的消息, 需要重新被邀请才能回来。") },
            confirmButton = {
                TextButton({
                    leaving = false
                    val me = Me.uid ?: return@TextButton
                    scope.launch { api.remove(group, me).onSuccess { onChanged(); onLeft() }.onFailure { error = it.message } }
                }) { Text("退出", color = c.error) }
            },
            dismissButton = { TextButton({ leaving = false }) { Text("取消") } },
        )
    }
}

@Composable
private fun MemberRow(m: RoomMember, myRole: String, onRole: (String) -> Unit, onKick: () -> Unit) {
    val c = MaterialTheme.colorScheme
    var menu by remember { mutableStateOf(false) }
    val isMe = m.id == Me.uid
    // 群主能改身份和踢任何人; 管理员只能踢普通成员
    val canRole = myRole == ROLE_OWNER && m.role != ROLE_OWNER
    val canKick = !isMe && (canRole || (myRole == ROLE_ADMIN && m.role == ROLE_MEMBER))
    Box {
        Row(Modifier.fillMaxWidth().clickable(enabled = canRole || canKick) { menu = true }.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            LetterAvatar(m.display, 32.dp)
            Column(Modifier.weight(1f).padding(start = 10.dp)) {
                Text(if (isMe) "${m.display} (我)" else m.display, fontSize = 14.sp, fontWeight = FontWeight.Medium)
                Text("@${m.name}", fontSize = 12.sp, color = c.outline)
            }
            Text(roleLabel(m.role), fontSize = 12.sp, color = if (m.role == ROLE_MEMBER) c.outline else c.primary)
        }
        DropdownMenu(menu, { menu = false }) {
            if (canRole) {
                val next = if (m.role == ROLE_ADMIN) ROLE_MEMBER else ROLE_ADMIN
                DropdownMenuItem({ Text(if (next == ROLE_ADMIN) "设为管理员" else "取消管理员") }, { menu = false; onRole(next) })
            }
            if (canKick) DropdownMenuItem({ Text("移出群", color = c.error) }, { menu = false; onKick() })
        }
    }
}

private fun expiry(ts: Long): String = if (ts <= 0) "" else " ${SimpleDateFormat("MM-dd HH:mm", Locale.CHINA).format(Date(ts))} 前有效。"
