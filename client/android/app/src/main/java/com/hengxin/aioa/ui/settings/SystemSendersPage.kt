package com.hengxin.aioa.ui.settings

import android.text.format.DateUtils
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.ui.chat.ChatDirectory
import com.hengxin.aioa.ui.chat.SenderEditSheet
import com.hengxin.aioa.ui.chat.SenderFace
import com.hengxin.aioa.ui.chat.SenderInfo
import com.hengxin.aioa.ui.chat.Senders

private const val FACE = 40

/**
 * 系统发送者与群 Agent (#128 #121): 服务端自己发消息用的来源 (第一次发言自动登记), 以及现有群 Agent 的发言身份。
 * 点一行改名, 换头像; 已移出的 Agent 不列 (服务端标 gone, 留着只为旧消息的头像) (#139)。
 */
@Composable
fun SystemSendersPage(dir: ChatDirectory, onBack: (() -> Unit)?) {
    LaunchedEffect(Unit) { dir.refreshSenders() }
    var editing by remember { mutableStateOf<String?>(null) }
    val (agents, system) = Senders.list().filter { !it.gone }.partition { it.agent }
    val c = Aioa.colors
    SettingsPageFrame(SettingsPage.SENDERS.title, onBack) {
        SettingsGroup(footer = "服务端的通知, 提醒, 同步都以这些身份发言; 新的第一次发言时自动出现在这里。改名后新消息按新名字发, 旧消息也按新名字显示。") {
            if (system.isEmpty()) Text("还没有系统发送者。", Modifier.padding(16.dp), color = c.textSecondary, fontSize = 13.sp)
            SenderRows(system) { editing = it }
        }
        if (agents.isNotEmpty()) SettingsGroup(footer = "现在接在群里的 Agent; 这里改的名字就是 Agent 设置里的名字, 移出群后不再列出。") {
            SenderRows(agents) { editing = it }
        }
    }
    editing?.let { sid -> SenderEditSheet(sid, sid, dir) { editing = null } }
}

@Composable
private fun SenderRows(list: List<SenderInfo>, open: (String) -> Unit) {
    val c = Aioa.colors
    list.forEachIndexed { i, s ->
        if (i > 0) RowDivider()
        Row(Modifier.fillMaxWidth().clickable { open(s.sid) }.padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            SenderFace(s.sid, s.display, FACE.dp, agent = s.agent)
            Column(Modifier.padding(start = 12.dp).weight(1f)) {
                Text(s.display, color = c.text, fontSize = 15.sp, fontWeight = FontWeight.Medium, maxLines = 1)
                val sub = (if (s.alias != null) "默认名 ${s.name} · " else "") + s.sid
                Text(sub, color = c.textSecondary, fontSize = 12.sp, maxLines = 1)
            }
            if (s.last > 0) Text(DateUtils.getRelativeTimeSpanString(s.last).toString(), color = c.textSecondary, fontSize = 11.sp)
        }
    }
}
