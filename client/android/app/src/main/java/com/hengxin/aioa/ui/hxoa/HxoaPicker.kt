package com.hengxin.aioa.ui.hxoa

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
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
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.pressable
import kotlinx.coroutines.launch

private const val SEP = "/"

/** 路径拆成面包屑: (显示名, 完整路径)。 */
private fun crumbs(path: String): List<Pair<String, String>> {
    val parts = path.split(SEP).filter { it.isNotEmpty() }
    return listOf(SEP to SEP) + parts.mapIndexed { i, p -> p to SEP + parts.take(i + 1).joinToString(SEP) }
}

private fun join(dir: String, name: String) = if (dir.endsWith(SEP)) dir + name else "$dir$SEP$name"

/**
 * 添加工作区: 在 hxoa 那台机器上选目录 (面包屑, 上一级, 新建文件夹)。
 * 不勾子目录 = 把当前目录加成一个工作区 (可填名字); 勾了 = 每个勾选的子目录各加一个, 名字用目录名。
 */
@Composable
internal fun AddWorkspacePage(api: HxoaApi, conn: String, existing: List<String>, onBack: () -> Unit, onDone: () -> Unit) {
    val c = Aioa.colors
    val scope = rememberCoroutineScope()
    var path by remember { mutableStateOf("") }
    var tick by remember { mutableIntStateOf(0) }
    var dir by remember { mutableStateOf<HxoaDir?>(null) }
    var err by remember { mutableStateOf<String?>(null) }
    val picked = remember { mutableStateListOf<String>() }
    var name by remember { mutableStateOf("") }
    var exec by remember { mutableStateOf(true) }
    var workers by remember { mutableStateOf(false) }
    var making by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    LaunchedEffect(path, tick) {
        err = null
        runCatching { api.browse(conn, path) }.onSuccess { dir = it; picked.clear() }.onFailure { err = it.message }
    }
    val d = dir
    val targets = if (d == null) emptyList() else if (picked.isEmpty()) listOf(d.path) else picked.map { join(d.path, it) }
    fun submit() {
        if (busy || targets.isEmpty()) return
        busy = true
        err = null
        scope.launch {
            val failed = targets.mapNotNull { p ->
                val n = if (picked.isEmpty()) name.trim() else ""
                runCatching { api.addWorkspace(conn, n, p, workers, exec) }.exceptionOrNull()?.let { "${p.substringAfterLast(SEP)}: ${it.message}" }
            }
            busy = false
            if (failed.isEmpty()) onDone() else err = failed.joinToString("\n")
        }
    }
    FullPage(onBack, "添加工作区", d?.path ?: "") {
        if (d != null) Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            crumbs(d.path).forEachIndexed { i, (label, full) ->
                if (i > 1) Text(SEP, c.textSecondary, 13)
                Text(label, if (full == d.path) c.text else c.accent, 13, Modifier.clip(RoundedCornerShape(6.dp)).pressable { path = full }.padding(horizontal = 4.dp, vertical = 4.dp))
            }
        }
        err?.let { Text(it, c.danger, 12, Modifier.padding(horizontal = 16.dp)) }
        LazyColumn(Modifier.weight(1f).fillMaxWidth()) {
            if (d != null && d.parent != d.path) item { DirRow("corner-left-up", "上一级", null) { path = d.parent } }
            item { DirRow("plus", "新建文件夹", null) { making = true } }
            items(d?.dirs.orEmpty(), key = { it }) { n ->
                val full = d?.let { join(it.path, n) } ?: n
                val used = full in existing
                DirRow("folder", if (used) "$n (已是工作区)" else n, if (used) null else n in picked, onCheck = { if (n in picked) picked.remove(n) else picked.add(n) }) { path = full }
            }
            if (d == null && err == null) item { Text("加载中...", c.textSecondary, 13, Modifier.padding(16.dp)) }
        }
        Column(Modifier.fillMaxWidth().background(c.surface).padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (picked.isEmpty()) OutlinedTextField(name, { name = it }, Modifier.fillMaxWidth(), singleLine = true, placeholder = { androidx.compose.material3.Text("名字 (默认用目录名)") })
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("允许执行命令", c.text, 13, Modifier.weight(1f))
                Switch(exec, { exec = it })
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(if (d?.git == true || picked.isNotEmpty()) "并行编辑 (workers)" else "并行编辑 (需 git 仓库)", c.text, 13, Modifier.weight(1f))
                Switch(workers, { workers = it }, enabled = d?.git == true || picked.isNotEmpty())
            }
            TextButton(::submit, Modifier.fillMaxWidth(), enabled = !busy && targets.isNotEmpty() && (picked.isNotEmpty() || d?.path !in existing)) {
                androidx.compose.material3.Text(if (busy) "添加中..." else if (picked.isEmpty()) "把当前目录加为工作区" else "添加 ${picked.size} 个工作区")
            }
        }
    }
    if (making && d != null) InputDialog("新建文件夹", "", "在 ${d.path} 下", { making = false }, valid = { it.isNotBlank() && !it.contains(SEP) && it != "." && it != ".." }) { n ->
        runCatching { api.mkdir(conn, d.path, n) }.map { p -> making = false; path = p; tick++; null }.getOrElse { it.message ?: "失败" }
    }
}

/** 目录一行: 点名字进入; checked 不为 null 时右侧有勾选框。 */
@Composable
private fun DirRow(icon: String, name: String, checked: Boolean?, onCheck: () -> Unit = {}, onOpen: () -> Unit) {
    val c = Aioa.colors
    Row(Modifier.fillMaxWidth().pressable(onOpen).padding(start = 16.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, if (icon == "folder") c.accent else c.textSecondary, 18.dp)
        Spacer(Modifier.width(10.dp))
        Text(name, c.text, 14, Modifier.weight(1f).padding(vertical = 12.dp))
        if (checked != null) Icon(if (checked) "square-check" else "square", if (checked) c.accent else c.textSecondary, 20.dp, Modifier.clip(RoundedCornerShape(6.dp)).pressable(onCheck).padding(10.dp))
    }
}
