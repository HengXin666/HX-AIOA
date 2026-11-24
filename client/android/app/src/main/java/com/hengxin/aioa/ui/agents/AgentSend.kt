package com.hengxin.aioa.ui.agents

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.ui.ChatModel
import com.hengxin.aioa.ui.chat.Onboard

private val BOX = RoundedCornerShape(12.dp)
private const val KEY_SHOWN = 8
private const val COMMAND_MARK = "hxaioa"

/** 接入语里密钥打码, 只留前几位。 */
private fun masked(text: String, key: String): String =
    if (key.isEmpty()) text else text.replace(key, key.take(KEY_SHOWN) + "••••••")

/**
 * 第三步: 命令放上面一键复制, 整段接入语折叠在下面; 密钥默认打码。
 * 底部实时显示它报到没有: 群资料里这把 key 的 joined 出现且不再 pending 就算接上了。
 */
@Composable
fun SendPane(model: ChatModel, group: String, name: String, ob: Onboard) {
    val clipboard = LocalClipboardManager.current
    val c = MaterialTheme.colorScheme
    var showKey by remember { mutableStateOf(false) }
    var showAll by remember { mutableStateOf(false) }
    var copied by remember { mutableStateOf<String?>(null) }
    val commands = ob.prompt.lines().filter { it.trimStart().startsWith(COMMAND_MARK) || it.startsWith("mkdir") }.joinToString("\n")
    val live = model.groups.directory.metas[group]?.agents?.firstOrNull { it.keyId == ob.agent.keyId }
    val joined = live?.joined != null && live.pending != true
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("发给 $name", fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
        Text("把整段接入语发给它最省事; 你自己在电脑上跑也行, 就复制下面三行命令。密钥只显示这一次。", fontSize = 12.sp, color = c.outline)
        Code(if (showKey) commands else masked(commands, ob.key))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button({ clipboard.setText(AnnotatedString(ob.prompt)); copied = "已复制接入语" }) { Text("复制接入语") }
            OutlinedButton({ clipboard.setText(AnnotatedString(commands)); copied = "已复制命令" }) { Text("只复制命令") }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton({ showKey = !showKey }) { Text(if (showKey) "隐藏密钥" else "显示密钥") }
            TextButton({ clipboard.setText(AnnotatedString(ob.key)); copied = "已复制密钥" }) { Text("只复制密钥") }
            TextButton({ showAll = !showAll }) { Text(if (showAll) "收起接入语" else "看整段接入语") }
        }
        if (showAll) Code(if (showKey) ob.prompt else masked(ob.prompt, ob.key))
        copied?.let { Text(it, fontSize = 12.sp, color = c.primary) }
        Row(Modifier.fillMaxWidth().background(c.surfaceVariant.copy(alpha = 0.6f), BOX).padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            StatusDot(if (joined) AgentState.LISTENING else AgentState.WAITING)
            Spacer(Modifier.width(10.dp))
            Text(if (joined) "✓ $name 已接入, 可以关掉了" else "等待 $name 报到…", fontSize = 14.sp, fontWeight = if (joined) FontWeight.Medium else FontWeight.Normal)
        }
    }
}

@Composable
private fun Code(text: String) {
    Text(
        text,
        Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceVariant, BOX).padding(12.dp),
        fontFamily = FontFamily.Monospace,
        fontSize = 12.sp,
        lineHeight = 17.sp,
    )
}

/** 重新接入后的发送页 (单独一层, 不走向导)。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SendSheet(model: ChatModel, group: String, name: String, ob: Onboard, close: () -> Unit) {
    ModalBottomSheet(onDismissRequest = close) {
        Column(Modifier.padding(horizontal = 18.dp).padding(bottom = 24.dp).verticalScroll(rememberScrollState())) {
            Text("旧密钥已作废。", fontSize = 12.sp, color = MaterialTheme.colorScheme.error)
            SendPane(model, group, name, ob)
        }
    }
}
