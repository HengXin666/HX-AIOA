package com.hengxin.aioa.ui.hxoa

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Dot
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.pressable
import kotlinx.coroutines.launch
import org.json.JSONObject

private val MONO = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 12.sp, lineHeight = 17.sp)
// 与 hxoa 的身份名规则一致
private val LABEL_RE = Regex("^[a-zA-Z0-9][a-zA-Z0-9._-]{0,31}$")

/** 一次要确认的操作: 标题, 说明, 按钮字, 动作。 */
private class Ask(val title: String, val text: String, val confirm: String, val run: suspend () -> Unit)

/** 工作区详情: 开关, 改名, 删除; 连接令牌 (复制连接提示, 合并, 删除, 新建)。 */
@Composable
internal fun WorkspacePage(api: HxoaApi, conn: String, ws: HxoaWs, onBack: () -> Unit, onChanged: () -> Unit) {
    val c = Aioa.colors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var err by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var ask by remember { mutableStateOf<Ask?>(null) }
    var renaming by remember { mutableStateOf(false) }
    var newToken by remember { mutableStateOf(false) }
    var shown by remember { mutableStateOf<Pair<String, String>?>(null) }
    fun act(f: suspend () -> Unit) {
        if (busy) return
        busy = true
        err = null
        scope.launch {
            runCatching { f() }.onSuccess { onChanged() }.onFailure { err = it.message }
            busy = false
        }
    }
    fun patch(k: String, v: Boolean) = act { api.patchWorkspace(conn, ws.id, JSONObject().put(k, v)) }
    FullPage(onBack, ws.name, ws.path, "trash-2" to {
        ask = Ask("删除工作区 ${ws.name}?", "目录本身不动; 它的 ${ws.tokens.size} 个连接令牌立刻失效。", "删除") { api.deleteWorkspace(conn, ws.id); onBack() }
    }) {
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            err?.let { Text(it, c.danger, 12) }
            Section {
                ToggleRow("允许执行命令", "关掉后 AI 只能读写文件", ws.exec, !busy) { patch("exec", it) }
                ToggleRow("并行编辑 (workers)", if (ws.git) "每个连接在自己的 git 工作树和分支里改" else "需要工作区是 git 仓库", ws.workers, !busy && (ws.git || ws.workers)) { patch("workers", it) }
                Row(Modifier.fillMaxWidth().pressable { renaming = true }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("改名", c.text, 14, Modifier.weight(1f))
                    Text(ws.name, c.textSecondary, 13)
                }
            }
            Text("连接令牌", c.textSecondary, 12, Modifier.padding(start = 4.dp, top = 4.dp))
            ws.tokens.forEachIndexed { i, t ->
                Stagger(i) {
                    TokenRow(t, ws.workers, busy,
                        onCopy = { act { copyText(context, api.prompt(conn, t.id)); Toast.makeText(context, "已复制 ${t.label} 的连接提示", Toast.LENGTH_SHORT).show() } },
                        onMerge = { ask = Ask("合并 ${t.label} 的分支?", "把 ${t.branch ?: "它的分支"} 合进工作区当前分支; 有冲突会自动撤销。", "合并") { shown = "合并结果" to api.merge(conn, t.id).ifEmpty { "已合并" } } },
                        onDelete = { ask = Ask("删除连接令牌 ${t.label}?", "用它的 AI 立刻断开。已全部合并的 worker 分支和干净的工作树会一起删掉。", "删除") { api.deleteToken(conn, t.id) } })
                }
            }
            if (ws.tokens.isEmpty()) Text("还没有连接令牌。新建一个, 把连接提示发给 AI。", c.textSecondary, 13, Modifier.padding(4.dp))
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).pressable { newToken = true }.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon("plus", c.accent, 18.dp)
                Spacer(Modifier.width(8.dp))
                Text("新建连接令牌", c.accent, 14)
            }
        }
    }
    ask?.let { a ->
        AlertDialog(
            onDismissRequest = { ask = null },
            title = { androidx.compose.material3.Text(a.title) },
            text = { androidx.compose.material3.Text(a.text) },
            confirmButton = { TextButton({ ask = null; act(a.run) }) { androidx.compose.material3.Text(a.confirm, color = c.danger) } },
            dismissButton = { TextButton({ ask = null }) { androidx.compose.material3.Text("取消") } },
        )
    }
    if (renaming) InputDialog("改名", ws.name, "工作区名字", { renaming = false }) { name ->
        runCatching { api.patchWorkspace(conn, ws.id, JSONObject().put("name", name)) }.map { renaming = false; onChanged(); null }.getOrElse { it.message ?: "失败" }
    }
    if (newToken) InputDialog("新建连接令牌", "", "身份名, 如 hark, claude (字母数字 . _ -)", { newToken = false }, valid = { LABEL_RE.matches(it) }) { label ->
        runCatching { api.addToken(conn, ws.id, label) }.map { p -> newToken = false; onChanged(); shown = "发给 $label 的连接提示" to p; null }.getOrElse { it.message ?: "失败" }
    }
    shown?.let { (title, text) -> TextDialog(title, text) { shown = null } }
}

@Composable
private fun Section(content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Aioa.colors.surface).padding(horizontal = 12.dp, vertical = 4.dp)) { content() }
}

@Composable
private fun ToggleRow(title: String, hint: String, on: Boolean, enabled: Boolean, set: (Boolean) -> Unit) {
    val c = Aioa.colors
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, c.text, 14)
            Text(hint, c.textSecondary, 12)
        }
        Switch(on, set, enabled = enabled)
    }
}

@Composable
private fun TokenRow(t: HxoaToken, workers: Boolean, busy: Boolean, onCopy: () -> Unit, onMerge: () -> Unit, onDelete: () -> Unit) {
    val c = Aioa.colors
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(c.surface).padding(start = 12.dp, top = 8.dp, bottom = 8.dp, end = 4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Dot(if (t.online) c.success else c.textSecondary)
            Spacer(Modifier.width(8.dp))
            Column(Modifier.weight(1f)) {
                Text(t.label, c.text, 14, weight = FontWeight.Medium)
                val worker = t.branch?.let { b -> listOfNotNull(b, t.ahead?.let { "领先 $it" }, if (t.dirty > 0) "${t.dirty} 个未提交" else null).joinToString(" · ") }
                Text(listOfNotNull(if (t.online) "在线" else "离线", "${t.ops} 次操作", worker).joinToString(" · "), c.textSecondary, 12)
            }
            IconButton("copy", c.accent, !busy, onCopy)
            if (workers && t.branch != null) IconButton("git-pull-request", c.textSecondary, !busy, onMerge)
            IconButton("trash-2", c.textSecondary, !busy, onDelete)
        }
    }
}

@Composable
private fun IconButton(icon: String, tint: androidx.compose.ui.graphics.Color, enabled: Boolean, onClick: () -> Unit) {
    Box(Modifier.size(40.dp).clip(CircleShape).pressable { if (enabled) onClick() }, contentAlignment = Alignment.Center) { Icon(icon, tint, 18.dp) }
}

/** 输入一行字的对话框; submit 返回 null 表示成功, 否则是错误文字。 */
@Composable
internal fun InputDialog(title: String, initial: String, hint: String, onDismiss: () -> Unit, valid: (String) -> Boolean = { it.isNotBlank() }, submit: suspend (String) -> String?) {
    val scope = rememberCoroutineScope()
    var value by remember { mutableStateOf(initial) }
    var busy by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { androidx.compose.material3.Text(title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(value, { value = it; err = null }, supportingText = { androidx.compose.material3.Text(hint) }, singleLine = true)
                err?.let { androidx.compose.material3.Text(it, fontSize = 12.sp, color = Aioa.colors.danger) }
            }
        },
        confirmButton = {
            TextButton({
                busy = true
                scope.launch {
                    err = submit(value.trim())
                    busy = false
                }
            }, enabled = !busy && valid(value.trim())) { androidx.compose.material3.Text(if (busy) "处理中..." else "确定") }
        },
        dismissButton = { TextButton(onDismiss, enabled = !busy) { androidx.compose.material3.Text("取消") } },
    )
}

/** 展示一段可复制的文字 (连接提示, 合并输出)。 */
@Composable
private fun TextDialog(title: String, text: String, onDismiss: () -> Unit) {
    val context = LocalContext.current
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { androidx.compose.material3.Text(title) },
        text = {
            Box(Modifier.heightIn(max = 360.dp).verticalScroll(rememberScrollState())) {
                SelectionContainer { androidx.compose.material3.Text(text, style = MONO, color = Aioa.colors.text) }
            }
        },
        confirmButton = { TextButton({ copyText(context, text); onDismiss() }) { androidx.compose.material3.Text("复制") } },
        dismissButton = { TextButton(onDismiss) { androidx.compose.material3.Text("关闭") } },
    )
}
