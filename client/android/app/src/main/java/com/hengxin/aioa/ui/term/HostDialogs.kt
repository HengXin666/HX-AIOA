package com.hengxin.aioa.ui.term

import android.content.Context
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.net.Api
import com.hengxin.aioa.net.ApiReply
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

private const val POST = "POST"
private const val PATH_PROBES = "api/v1/probes"
private const val PATH_TICKET = "api/v1/shell/ticket"
private const val CANCEL = "取消"
private val NAME_RE = Regex("^[a-z0-9][a-z0-9-]{0,31}$")

private suspend fun post(context: Context, path: String, body: JSONObject): ApiReply =
    withContext(Dispatchers.IO) { Api.call(context, POST, listOf(path), body) }

/** 添加主机: 填名字, 选是否允许终端 → 服务端建专用 key, 给出一行安装命令 (key 只显示这一次)。 */
@Composable
fun AddHostDialog(onClose: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    var name by remember { mutableStateOf("") }
    var shell by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var command by remember { mutableStateOf<String?>(null) }
    val valid = NAME_RE.matches(name)
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text(if (command == null) "添加主机" else "在主机上执行") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                val cmd = command
                if (cmd == null) {
                    OutlinedTextField(name, { name = it.trim().lowercase() }, Modifier.fillMaxWidth(), label = { Text("名字 (如 nas-01)") }, singleLine = true)
                    Hint("小写字母, 数字和 -, 卡片上显示这个名字。")
                    Row(Modifier.fillMaxWidth().clickable { shell = !shell }.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(shell, { shell = it })
                        Text("允许终端", fontSize = 14.sp)
                    }
                    Hint("终端以安装用户的权限运行, 建议用普通用户安装; 需要 python3。每次打开都要输入密码, 15 分钟无操作自动断开。")
                } else {
                    Hint("需要 Node 22+。命令里有这台主机专用的 key, 只显示这一次, 别发给别人。")
                    SelectionContainer { Text(cmd, Modifier.padding(top = 8.dp), fontSize = 12.sp, fontFamily = FontFamily.Monospace) }
                }
                if (error.isNotEmpty()) Text(error, Modifier.padding(top = 8.dp), color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
            }
        },
        confirmButton = {
            val cmd = command
            if (cmd != null) {
                TextButton({ clipboard.setText(AnnotatedString(cmd)) }) { Text("复制命令") }
            } else {
                TextButton(
                    {
                        busy = true
                        error = ""
                        scope.launch {
                            val r = post(context, PATH_PROBES, JSONObject().put("name", name).put("shell", shell))
                            busy = false
                            r.body?.optString("command")?.takeIf { it.isNotEmpty() }?.let { command = it } ?: run { error = r.error ?: "添加失败" }
                        }
                    },
                    enabled = valid && !busy,
                ) { Text(if (busy) "生成中..." else "生成安装命令") }
            }
        },
        dismissButton = { TextButton(onClose) { Text(if (command == null) CANCEL else "完成") } },
    )
}

/** 打开终端前再输一次账号密码, 换一张 60 秒的票据。 */
@Composable
fun ShellPasswordDialog(subject: String, onClose: () -> Unit, onTicket: (String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text("打开 $subject 的终端") },
        text = {
            Column {
                Hint("终端能在这台主机上执行任何命令, 请再输入一次账号密码。")
                OutlinedTextField(
                    password,
                    { password = it },
                    Modifier.fillMaxWidth().padding(top = 8.dp),
                    label = { Text("密码") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                )
                if (error.isNotEmpty()) Text(error, Modifier.padding(top = 8.dp), color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
            }
        },
        confirmButton = {
            TextButton(
                {
                    busy = true
                    error = ""
                    scope.launch {
                        val r = post(context, PATH_TICKET, JSONObject().put("subject", subject).put("password", password))
                        busy = false
                        password = ""
                        r.body?.optString("ticket")?.takeIf { it.isNotEmpty() }?.let(onTicket) ?: run { error = r.error ?: "验证失败" }
                    }
                },
                enabled = password.isNotEmpty() && !busy,
            ) { Text(if (busy) "验证中..." else "打开") }
        },
        dismissButton = { TextButton(onClose) { Text(CANCEL) } },
    )
}

@Composable
private fun Hint(text: String) {
    Text(text, Modifier.padding(top = 4.dp), fontSize = 12.sp, color = MaterialTheme.colorScheme.outline)
}
