package com.hengxin.aioa.ui.hxoa

import android.content.Context
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
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
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Card
import com.hengxin.aioa.kit.CardHeader
import com.hengxin.aioa.kit.Chip
import com.hengxin.aioa.kit.Dot
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.pressable
import com.hengxin.aioa.net.Api
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

// hxoa 接入 (内置插件 hengxin666.hxoa, #97): 服务器页的小面板 + 点开后的文件 / 命令页。接口见 docs/api/hxoa.md

private const val PATH = "api/v1/hxoa"
private const val GET = "GET"
private const val POST = "POST"
private const val DELETE = "DELETE"
// 大于 512K 的文件 hxoa 要求给行范围, 先看前这么多行
private const val HEAD_LINES = 400
private const val OUT_KEEP = 20
private val QUICK = listOf("git status -sb", "git log --oneline -15", "git diff --stat", "ls -la")
private val MONO = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 12.sp, lineHeight = 17.sp)

data class HxoaHello(val workspace: String, val identity: String, val mode: String, val branch: String?, val base: String?, val exec: Boolean)
data class HxoaConn(val id: String, val name: String, val base: String, val hello: HxoaHello?, val error: String?)
data class HxoaEntry(val path: String, val dir: Boolean, val bytes: Long)
data class HxoaRun(val cmd: String, val code: Int, val out: String, val ms: Long)

private fun JSONObject.s(k: String) = optString(k).ifEmpty { null }

/** 服务端接口; 只能在协程里调, 自己切到 IO。 */
private class HxoaApi(private val context: Context) {
    private suspend fun call(method: String, segs: List<String>, body: JSONObject? = null, query: Map<String, String> = emptyMap()): JSONObject = withContext(Dispatchers.IO) {
        val r = Api.call(context, method, listOf(PATH) + segs, body, query)
        r.body ?: error(r.error ?: "请求失败")
    }

    suspend fun list(): List<HxoaConn> {
        val a = call(GET, emptyList()).optJSONArray("conns") ?: return emptyList()
        return (0 until a.length()).map { i ->
            val o = a.getJSONObject(i)
            val h = o.optJSONObject("hello")?.let { HxoaHello(it.optString("workspace"), it.optString("identity"), it.optString("mode"), it.s("branch"), it.s("base"), it.optBoolean("exec")) }
            HxoaConn(o.optString("id"), o.optString("name"), o.optString("base"), h, o.s("error"))
        }
    }

    suspend fun add(name: String, base: String, token: String) {
        call(POST, emptyList(), JSONObject().put("name", name).put("base", base).put("token", token))
    }

    suspend fun remove(id: String) {
        call(DELETE, listOf(id))
    }

    suspend fun ls(id: String, path: String): List<HxoaEntry> {
        val a = call(GET, listOf(id, "ls"), query = mapOf("path" to path, "depth" to "1")).optJSONArray("entries") ?: return emptyList()
        return (0 until a.length()).map { a.getJSONObject(it).let { o -> HxoaEntry(o.optString("p"), o.optBoolean("d"), o.optLong("b")) } }
            .sortedWith(compareBy<HxoaEntry> { !it.dir }.thenBy { it.path.lowercase() })
    }

    /** 读文件; 太大时只读前 HEAD_LINES 行, 第二个值标出来。 */
    suspend fun read(id: String, path: String): Pair<String, Boolean> = try {
        call(GET, listOf(id, "read"), query = mapOf("path" to path)).let { if (it.optBoolean("binary")) "(二进制文件, 不显示)" else it.optString("content") } to false
    } catch (e: IllegalStateException) {
        // 服务端透传 hxoa 的 413: "hxoa 413: ..."
        if (e.message?.contains("hxoa 413") != true) throw e
        call(GET, listOf(id, "read"), query = mapOf("path" to path, "start" to "1", "end" to HEAD_LINES.toString())).optString("content") to true
    }

    /** 新建文件夹; false = 原来就有。hxoa 2.3.0 起才有这个接口。 */
    suspend fun mkdir(id: String, path: String): Boolean = call(POST, listOf(id, "mkdir"), JSONObject().put("path", path)).optBoolean("created")

    suspend fun exec(id: String, cmd: String, dir: String): HxoaRun {
        val b = call(POST, listOf(id, "exec"), JSONObject().put("cmd", cmd).apply { if (dir.isNotEmpty()) put("dir", dir) })
        val out = listOfNotNull(b.optString("stdout").ifEmpty { null }, b.optString("stderr").ifEmpty { null }).joinToString("\n") +
            (if (b.optBoolean("timedOut")) "\n(超时, 已结束)" else "") + (if (b.optBoolean("truncated")) "\n(输出过长, 已截断)" else "")
        return HxoaRun(cmd, b.optInt("code", -1), out, b.optLong("ms"))
    }
}

/** 服务器页的 hxoa 面板: 每条接入的在线状态, 工作区与 worker 分支; 主人没启用插件时 (接口 404) 不显示。 */
@Composable
fun HxoaCard() {
    val context = LocalContext.current
    val api = remember { HxoaApi(context.applicationContext) }
    var conns by remember { mutableStateOf<List<HxoaConn>?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    var open by remember { mutableStateOf<HxoaConn?>(null) }
    var adding by remember { mutableStateOf(false) }
    LaunchedEffect(reload) { conns = runCatching { api.list() }.getOrNull() }
    val list = conns ?: return
    val c = Aioa.colors
    Card {
        CardHeader("terminal", "hxoa", if (list.isEmpty()) "未接入" else "${list.count { it.hello != null }}/${list.size} 在线")
        list.forEach { conn ->
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).pressable { open = conn }.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Dot(if (conn.hello != null) c.success else c.textSecondary)
                Spacer(Modifier.width(8.dp))
                Text(conn.name, c.text, 13, Modifier.weight(1f))
                val h = conn.hello
                Text(if (h == null) "离线" else listOfNotNull(h.workspace, h.branch).joinToString(" · "), c.textSecondary, 12)
            }
        }
        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).pressable { adding = true }.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon("plus", c.accent, 16.dp)
            Spacer(Modifier.width(6.dp))
            Text("添加接入", c.accent, 13)
        }
    }
    if (adding) AddDialog(api, { adding = false }) { adding = false; reload++ }
    open?.let { conn ->
        Dialog({ open = null }, DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
            Box(Modifier.fillMaxSize().background(c.background).systemBarsPadding().imePadding()) {
                HxoaPage(api, conn, { open = null }) { open = null; reload++ }
            }
        }
    }
}

@Composable
private fun AddDialog(api: HxoaApi, onDismiss: () -> Unit, onDone: () -> Unit) {
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var base by remember { mutableStateOf("https://") }
    var token by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { androidx.compose.material3.Text("接入 hxoa") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(name, { name = it }, label = { androidx.compose.material3.Text("名字") }, singleLine = true)
                OutlinedTextField(base, { base = it }, label = { androidx.compose.material3.Text("服务地址") }, singleLine = true)
                OutlinedTextField(token, { token = it }, label = { androidx.compose.material3.Text("令牌 (hxoa 面板上建的)") }, singleLine = true, visualTransformation = PasswordVisualTransformation())
                androidx.compose.material3.Text("令牌只存在服务端, 加密保存。", fontSize = 12.sp, color = Aioa.colors.textSecondary)
                err?.let { androidx.compose.material3.Text(it, fontSize = 12.sp, color = Aioa.colors.danger) }
            }
        },
        confirmButton = {
            TextButton({
                busy = true
                err = null
                scope.launch {
                    runCatching { api.add(name.trim(), base.trim(), token.trim()) }.onSuccess { onDone() }.onFailure { err = it.message }
                    busy = false
                }
            }, enabled = !busy && name.isNotBlank() && token.isNotBlank()) { androidx.compose.material3.Text(if (busy) "验证中..." else "接入") }
        },
        dismissButton = { TextButton(onDismiss, enabled = !busy) { androidx.compose.material3.Text("取消") } },
    )
}

/** 一条接入: 文件 (逐级浏览, 点开看内容) 与命令 (在当前目录跑)。返回键: 关文件 → 上一级目录 → 关页面。 */
@Composable
private fun HxoaPage(api: HxoaApi, conn: HxoaConn, onBack: () -> Unit, onRemoved: () -> Unit) {
    val c = Aioa.colors
    val scope = rememberCoroutineScope()
    val h = conn.hello
    var cmdTab by remember { mutableStateOf(false) }
    var path by remember { mutableStateOf("") }
    var entries by remember { mutableStateOf<List<HxoaEntry>?>(null) }
    var file by remember { mutableStateOf<String?>(null) }
    var content by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    var err by remember { mutableStateOf<String?>(null) }
    var removing by remember { mutableStateOf(false) }
    var making by remember { mutableStateOf(false) }
    var lsTick by remember { mutableIntStateOf(0) }
    val runs = remember { mutableStateListOf<HxoaRun>() }
    var cmd by remember { mutableStateOf("") }
    var running by remember { mutableStateOf(false) }
    val parent = path.substringBeforeLast('/', "")
    BackHandler {
        when {
            file != null -> file = null
            path.isNotEmpty() && !cmdTab -> path = parent
            else -> onBack()
        }
    }
    LaunchedEffect(path, lsTick) {
        entries = null
        err = null
        runCatching { api.ls(conn.id, path) }.onSuccess { entries = it }.onFailure { err = it.message }
    }
    LaunchedEffect(file) {
        val f = file ?: return@LaunchedEffect
        content = null
        runCatching { api.read(conn.id, f) }.onSuccess { content = it }.onFailure { err = it.message }
    }
    fun run(line: String) {
        if (line.isBlank() || running) return
        running = true
        scope.launch {
            runCatching { api.exec(conn.id, line, path) }.onSuccess { runs.add(0, it); if (runs.size > OUT_KEEP) runs.removeAt(runs.lastIndex) }.onFailure { runs.add(0, HxoaRun(line, -1, it.message ?: "失败", 0)) }
            running = false
        }
    }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().background(c.surface).padding(horizontal = 4.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(44.dp).clip(CircleShape).pressable { if (file != null) file = null else onBack() }, contentAlignment = Alignment.Center) { Icon("chevron-left", c.text, 24.dp) }
            Column(Modifier.weight(1f)) {
                Text(file?.substringAfterLast('/') ?: conn.name, c.text, 16, weight = FontWeight.SemiBold)
                Text(if (h == null) (conn.error ?: "离线") else listOfNotNull(h.workspace, h.mode, h.branch?.let { b -> h.base?.let { "$b ← $it" } ?: b }).joinToString(" · "), c.textSecondary, 12)
            }
            Box(Modifier.size(44.dp).clip(CircleShape).pressable { removing = true }, contentAlignment = Alignment.Center) { Icon("trash-2", c.textSecondary, 20.dp) }
        }
        val f = file
        if (f != null) {
            val ct = content
            Box(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).horizontalScroll(rememberScrollState()).padding(12.dp)) {
                SelectionContainer { androidx.compose.material3.Text(ct?.first ?: (err ?: "加载中..."), style = MONO, color = c.text) }
            }
            if (ct?.second == true) Text("文件较大, 只显示前 $HEAD_LINES 行", c.textSecondary, 12, Modifier.padding(12.dp))
            return@Column
        }
        Row(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Chip("文件", !cmdTab) { cmdTab = false }
            Chip("命令", cmdTab) { cmdTab = true }
            Spacer(Modifier.weight(1f))
            Text("/" + path, c.textSecondary, 12, Modifier.align(Alignment.CenterVertically))
        }
        err?.let { Text(it, c.danger, 12, Modifier.padding(horizontal = 12.dp)) }
        if (!cmdTab) {
            LazyColumn(Modifier.weight(1f).fillMaxWidth()) {
                if (path.isNotEmpty()) item { EntryRow("corner-left-up", "..", "") { path = parent } }
                item { EntryRow("plus", "新建文件夹", "") { making = true } }
                items(entries.orEmpty(), key = { it.path }) { e ->
                    val name = e.path.trimEnd('/').substringAfterLast('/')
                    EntryRow(if (e.dir) "folder" else "file", name, if (e.dir) "" else size(e.bytes)) { if (e.dir) path = e.path.trimEnd('/') else file = e.path }
                }
                if (entries == null && err == null) item { Text("加载中...", c.textSecondary, 13, Modifier.padding(16.dp)) }
            }
        } else {
            val canExec = h?.exec == true
            Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                QUICK.forEach { q -> Chip(q, false) { if (canExec) run(q) } }
            }
            Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(cmd, { cmd = it }, Modifier.weight(1f), enabled = canExec, singleLine = true, textStyle = MONO, placeholder = { androidx.compose.material3.Text(if (canExec) "在 /$path 下执行" else "这台 hxoa 关了命令执行", fontSize = 12.sp) })
                Box(Modifier.size(44.dp).clip(CircleShape).pressable { if (canExec) run(cmd) }, contentAlignment = Alignment.Center) { Icon("play", if (canExec && !running) c.accent else c.textSecondary, 22.dp) }
            }
            LazyColumn(Modifier.weight(1f).fillMaxWidth().padding(horizontal = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (running) item { Text("执行中...", c.textSecondary, 12) }
                items(runs) { r ->
                    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(c.surfaceAlt).padding(10.dp)) {
                        Text("$ ${r.cmd}  →  ${r.code} · ${r.ms}ms", if (r.code == 0) c.textSecondary else c.danger, 12)
                        SelectionContainer { androidx.compose.material3.Text(r.out, style = MONO, color = c.text, modifier = Modifier.horizontalScroll(rememberScrollState())) }
                    }
                }
            }
        }
    }
    if (making) NameDialog("新建文件夹", "在 /$path 下", { making = false }) { name ->
        val p = if (path.isEmpty()) name else "$path/$name"
        runCatching { api.mkdir(conn.id, p) }.map { created -> making = false; if (created) path = p else lsTick++; null }.getOrElse { it.message ?: "失败" }
    }
    if (removing) AlertDialog(
        onDismissRequest = { removing = false },
        title = { androidx.compose.material3.Text("删掉这条接入?") },
        text = { androidx.compose.material3.Text("只删 AIOA 这边的记录; 要让令牌失效, 去 hxoa 面板删令牌。") },
        confirmButton = { TextButton({ removing = false; scope.launch { runCatching { api.remove(conn.id) }.onSuccess { onRemoved() }.onFailure { err = it.message } } }) { androidx.compose.material3.Text("删除", color = c.danger) } },
        dismissButton = { TextButton({ removing = false }) { androidx.compose.material3.Text("取消") } },
    )
}

@Composable
private fun EntryRow(icon: String, name: String, meta: String, onClick: () -> Unit) {
    val c = Aioa.colors
    Row(Modifier.fillMaxWidth().pressable(onClick).padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, if (icon == "folder") c.accent else c.textSecondary, 18.dp)
        Spacer(Modifier.width(10.dp))
        Text(name, c.text, 14, Modifier.weight(1f))
        if (meta.isNotEmpty()) Text(meta, c.textSecondary, 12)
    }
}

private fun size(b: Long): String = when {
    b >= 1 shl 20 -> "%.1f MB".format(b / 1048576.0)
    b >= 1 shl 10 -> "%.1f KB".format(b / 1024.0)
    else -> "$b B"
}

/** 输入一个名字的小对话框; submit 返回 null 表示成功, 否则是错误文字。 */
@Composable
private fun NameDialog(title: String, hint: String, onDismiss: () -> Unit, submit: suspend (String) -> String?) {
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf<String?>(null) }
    val bad = name.isBlank() || name.contains('/') || name.trim() == "." || name.trim() == ".."
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { androidx.compose.material3.Text(title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(name, { name = it; err = null }, label = { androidx.compose.material3.Text("名字") }, supportingText = { androidx.compose.material3.Text(hint) }, singleLine = true)
                err?.let { androidx.compose.material3.Text(it, fontSize = 12.sp, color = Aioa.colors.danger) }
            }
        },
        confirmButton = {
            TextButton({
                busy = true
                scope.launch {
                    err = submit(name.trim())
                    busy = false
                }
            }, enabled = !busy && !bad) { androidx.compose.material3.Text(if (busy) "创建中..." else "创建") }
        },
        dismissButton = { TextButton(onDismiss, enabled = !busy) { androidx.compose.material3.Text("取消") } },
    )
}
