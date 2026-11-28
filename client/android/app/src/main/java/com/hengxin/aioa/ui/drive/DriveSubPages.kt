package com.hengxin.aioa.ui.drive

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Chip
import com.hengxin.aioa.kit.Glyph
import com.hengxin.aioa.kit.HomeRow
import com.hengxin.aioa.kit.SoftTag
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.ui.ErrorNote
import com.hengxin.aioa.ui.hxoa.FullPage
import com.hengxin.aioa.ui.hxoa.copyText
import kotlinx.coroutines.launch

/** 选目标文件夹: 面包屑 + 子文件夹, "移到这里"; 不能移到自己里面, 附件目录不能选。 */
@Composable
internal fun MovePicker(api: DriveApi, start: String, n: DriveNode, close: () -> Unit, submit: suspend (String) -> String?) {
    val scope = rememberCoroutineScope()
    var at by remember { mutableStateOf(start) }
    var dirs by remember { mutableStateOf<List<DriveNode>>(emptyList()) }
    var err by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    LaunchedEffect(at) {
        dirs = api.cached(at).orEmpty().filter { it.dir }
        runCatching { api.list(at) }.onSuccess { l -> dirs = l.items.filter { it.dir }; err = null }.onFailure { err = it.message }
    }
    val self = n.path.ifEmpty { null }
    val bad = DrivePaths.readonly(at, DriveGate.whole) || (n.dir && self != null && (at == self || at.startsWith("$self/")))
    AlertDialog(
        onDismissRequest = { if (!busy) close() },
        title = { androidx.compose.material3.Text("移动 ${n.name}") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Crumbs(at, "网盘") { at = it }
                err?.let { Text(it, Aioa.colors.danger, 12, maxLines = 3) }
                LazyColumn(Modifier.heightIn(max = 320.dp)) {
                    itemsIndexed(sortNodes(dirs, DriveSort()).filter { it.id != n.id }, key = { _, d -> d.id }) { i, d ->
                        HomeRow(d.name, divider = i > 0, lead = { Glyph("folder") }, onClick = { at = DrivePaths.join(at, d.name) })
                    }
                }
            }
        },
        confirmButton = {
            TextButton({ busy = true; scope.launch { err = submit(at); busy = false } }, enabled = !busy && !bad) { androidx.compose.material3.Text("移到这里") }
        },
        dismissButton = { TextButton(close, enabled = !busy) { androidx.compose.material3.Text("取消") } },
    )
}

/** 新建分享: 选有效期, 可选密码; 建好后显示链接, 复制链接与密码。 */
@Composable
internal fun ShareDialog(api: DriveApi, n: DriveNode, close: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var ttl by remember { mutableIntStateOf(1) }
    var password by remember { mutableStateOf("") }
    var url by remember { mutableStateOf<String?>(null) }
    var err by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = { if (!busy) close() },
        title = { androidx.compose.material3.Text("分享 ${n.name}") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                val made = url
                if (made == null) {
                    Text("有效期", Aioa.colors.textSecondary, 13)
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { SHARE_TTLS.forEachIndexed { i, (label, _) -> Chip(label, ttl == i) { ttl = i } } }
                    OutlinedTextField(password, { password = it.take(PASSWORD_MAX) }, singleLine = true, placeholder = { androidx.compose.material3.Text("密码 (可不填)") })
                    if (password.isNotEmpty()) Text("有密码的链接浏览器里打不开输入框, 对方要用 App 或带上密码访问", Aioa.colors.textSecondary, 12, maxLines = 3)
                } else {
                    Text(made, Aioa.colors.text, 13, maxLines = 3)
                    if (password.isNotEmpty()) Text("密码: $password", Aioa.colors.text, 13)
                }
                err?.let { Text(it, Aioa.colors.danger, 12, maxLines = 3) }
            }
        },
        confirmButton = {
            val made = url
            if (made != null) TextButton({ copyText(context, made); toast(context, "链接已复制") }) { androidx.compose.material3.Text("复制链接") }
            else TextButton({
                busy = true
                scope.launch {
                    runCatching { api.share(n.id, SHARE_TTLS[ttl].second, password) }.onSuccess { url = it; err = null }.onFailure { err = it.message }
                    busy = false
                }
            }, enabled = !busy) { androidx.compose.material3.Text(if (busy) "生成中..." else "生成链接") }
        },
        dismissButton = {
            Row {
                if (url != null && password.isNotEmpty()) TextButton({ copyText(context, password); toast(context, "密码已复制") }) { androidx.compose.material3.Text("复制密码") }
                TextButton(close, enabled = !busy) { androidx.compose.material3.Text("关闭") }
            }
        },
    )
}

private const val PASSWORD_MAX = 64

/** 回收站: 恢复, 彻底删除, 清空。 */
@Composable
internal fun TrashPage(api: DriveApi, modifier: Modifier, back: () -> Unit) {
    val scope = rememberCoroutineScope()
    var tick by remember { mutableIntStateOf(0) }
    var list by remember { mutableStateOf<List<DriveNode>?>(null) }
    var err by remember { mutableStateOf<DriveError?>(null) }
    var emptying by remember { mutableStateOf(false) }
    LaunchedEffect(tick) { runCatching { api.trash() }.onSuccess { list = it; err = null }.onFailure { err = it as? DriveError } }
    val act = { f: suspend () -> Unit -> scope.launch { runCatching { f() }.onFailure { err = it as? DriveError }; tick++ } }
    Column(modifier.fillMaxSize()) {
        FullPage(back, "回收站", "删除的文件留在这里, 可以恢复", "trash-2" to { emptying = true }) {
            err?.let { e -> ErrorNote(e.message ?: "出错了", Modifier.fillMaxWidth().padding(12.dp), e.kind, onRetry = { tick++ }) { err = null } }
            val items = list
            if (items != null && items.isEmpty()) Note("trash-2", "回收站是空的", Modifier.padding(12.dp))
            LazyColumn(Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp)) {
                itemsIndexed(items.orEmpty(), key = { _, n -> n.id }) { i, n ->
                    HomeRow(n.name, listOf(if (n.dir) "文件夹" else sizeText(n.size), "删除于 ${timeText(n.deletedAt)}").joinToString(" · "), divider = i > 0, lead = { Glyph(iconOf(n)) }, end = {
                        Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                            ToolIcon("undo-2") { act { api.restore(n.id) } }
                            ToolIcon("x") { act { api.purge(n.id) } }
                        }
                    })
                }
            }
        }
    }
    if (emptying) AlertDialog(
        onDismissRequest = { emptying = false },
        title = { androidx.compose.material3.Text("清空回收站?") },
        text = { androidx.compose.material3.Text("彻底删除, 不能恢复。") },
        confirmButton = { TextButton({ emptying = false; act { api.emptyTrash() } }) { androidx.compose.material3.Text("清空", color = Aioa.colors.danger) } },
        dismissButton = { TextButton({ emptying = false }) { androidx.compose.material3.Text("取消") } },
    )
}

/** 我的分享: 链接, 到期, 有没有密码; 复制与撤销。 */
@Composable
internal fun SharesPage(api: DriveApi, modifier: Modifier, back: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var tick by remember { mutableIntStateOf(0) }
    var list by remember { mutableStateOf<List<DriveShare>?>(null) }
    var err by remember { mutableStateOf<DriveError?>(null) }
    LaunchedEffect(tick) { runCatching { api.shares() }.onSuccess { list = it; err = null }.onFailure { err = it as? DriveError } }
    val c = Aioa.colors
    val now = System.currentTimeMillis()
    Column(modifier.fillMaxSize()) {
        FullPage(back, "我的分享", "链接打开的是 Drive 的公开地址") {
            err?.let { e -> ErrorNote(e.message ?: "出错了", Modifier.fillMaxWidth().padding(12.dp), e.kind, onRetry = { tick++ }) { err = null } }
            val items = list
            if (items != null && items.isEmpty()) Note("link", "还没有分享", Modifier.padding(12.dp))
            LazyColumn(Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp)) {
                itemsIndexed(items.orEmpty(), key = { _, s -> s.id }) { i, s ->
                    val exp = s.expiresAt
                    val sub = if (exp == null) "永久有效" else if (exp < now) "已过期" else "${timeText(exp)} 到期"
                    HomeRow(s.name, sub, divider = i > 0, lead = { Glyph("link") }, end = {
                        Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                            if (s.hasPassword) SoftTag("密码", c.warning)
                            ToolIcon("copy") { copyText(context, s.url); toast(context, "链接已复制") }
                            ToolIcon("x") { scope.launch { runCatching { api.unshare(s.id) }.onFailure { err = it as? DriveError }; tick++ } }
                        }
                    })
                }
            }
        }
    }
}
