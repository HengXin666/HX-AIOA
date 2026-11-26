package com.hengxin.aioa.ui.hxoa

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.MutableTransitionState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
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
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Card
import com.hengxin.aioa.kit.CardHeader
import com.hengxin.aioa.kit.Dot
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.pressable
import com.hengxin.aioa.ui.settings.rememberCached
import kotlinx.coroutines.launch

// hxoa 管理 (内置插件 hengxin666.hxoa, #104): 服务器页的小面板 → 一台 hxoa 的工作区列表 → 工作区详情 / 添加工作区。
// 列表先显示本机缓存 (内存 → 磁盘), 后台刷新; 各项自上而下逐个渐显 (#108)。

private const val STAGGER_MS = 45
private const val FADE_MS = 220

/** 自上而下逐项渐显: 第 index 项晚 index * STAGGER_MS 出现。 */
@Composable
internal fun Stagger(index: Int, content: @Composable () -> Unit) {
    val state = remember { MutableTransitionState(false).apply { targetState = true } }
    AnimatedVisibility(state, enter = fadeIn(tween(FADE_MS, index * STAGGER_MS)) + slideInVertically(tween(FADE_MS, index * STAGGER_MS)) { it / 4 }) { content() }
}

/** 全屏子页: 顶栏 (返回, 标题, 副标题, 右侧按钮) + 内容。 */
@Composable
internal fun FullPage(onBack: () -> Unit, title: String, sub: String, action: Pair<String, () -> Unit>? = null, content: @Composable ColumnScope.() -> Unit) {
    val c = Aioa.colors
    Dialog(onBack, DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Column(Modifier.fillMaxSize().background(c.background).systemBarsPadding().imePadding()) {
            Row(Modifier.fillMaxWidth().background(c.surface).padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(44.dp).clip(CircleShape).pressable(onBack), contentAlignment = Alignment.Center) { Icon("chevron-left", c.text, 24.dp) }
                Column(Modifier.weight(1f)) {
                    Text(title, c.text, 16, weight = FontWeight.SemiBold)
                    if (sub.isNotEmpty()) Text(sub, c.textSecondary, 12)
                }
                action?.let { (icon, f) -> Box(Modifier.size(44.dp).clip(CircleShape).pressable(f), contentAlignment = Alignment.Center) { Icon(icon, c.textSecondary, 20.dp) } }
            }
            content()
        }
    }
}

/** 服务器页的 hxoa 面板: 每台的在线状态与版本; 主人没启用插件 (接口 404) 且没有缓存时不显示。 */
@Composable
fun HxoaCard() {
    var reload by remember { mutableIntStateOf(0) }
    val cached = rememberCached(CACHE_CONNS, HXOA_PATH, reload = reload)
    var open by remember { mutableStateOf<HxoaConn?>(null) }
    var adding by remember { mutableStateOf(false) }
    val list = cached.body?.let(::parseConns) ?: return
    val c = Aioa.colors
    Card {
        CardHeader("terminal", "hxoa", if (list.isEmpty()) "未接入" else "${list.count { it.online }}/${list.size} 在线")
        list.forEachIndexed { i, conn ->
            Stagger(i) {
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).pressable { open = conn }.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Dot(if (conn.online) c.success else if (conn.legacy) c.danger else c.textSecondary)
                    Spacer(Modifier.width(8.dp))
                    Text(conn.name, c.text, 13, Modifier.weight(1f))
                    Text(if (conn.legacy) "需重新接入" else conn.server ?: "离线", c.textSecondary, 12)
                }
            }
        }
        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).pressable { adding = true }.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon("plus", c.accent, 16.dp)
            Spacer(Modifier.width(6.dp))
            Text("接入 hxoa", c.accent, 13)
        }
    }
    val api = HxoaApi(LocalContext.current.applicationContext)
    if (adding) AddConnDialog(api, { adding = false }) { adding = false; reload++ }
    open?.let { conn -> ConnPage(api, conn, { open = null; reload++ }) }
}

@Composable
private fun AddConnDialog(api: HxoaApi, onDismiss: () -> Unit, onDone: () -> Unit) {
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
                OutlinedTextField(token, { token = it }, label = { androidx.compose.material3.Text("管理令牌 (hxadm_ 开头)") }, singleLine = true, visualTransformation = PasswordVisualTransformation())
                androidx.compose.material3.Text("在 hxoa 面板 远程管理 里建 (需 2.4.0+)。令牌只存在服务端, 加密保存。", fontSize = 12.sp, color = Aioa.colors.textSecondary)
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

/** 一台 hxoa: 工作区列表 (先显示缓存), 点开详情, 右上角删接入, 底部添加工作区。返回键: 子页 → 本页 → 服务器页。 */
@Composable
private fun ConnPage(api: HxoaApi, conn: HxoaConn, onBack: () -> Unit) {
    val c = Aioa.colors
    val scope = rememberCoroutineScope()
    var reload by remember { mutableIntStateOf(0) }
    val cached = if (conn.legacy) null else rememberCached(cacheState(conn.id), "$HXOA_PATH/${conn.id}/state", reload = reload)
    val state = cached?.body?.let(::parseState)
    var openWs by remember { mutableStateOf<String?>(null) }
    var picking by remember { mutableStateOf(false) }
    var removing by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf<String?>(null) }
    val sub = state?.let { listOfNotNull(it.server, it.publicUrl.ifEmpty { null }).joinToString(" · ") } ?: (conn.error ?: conn.base)
    FullPage(onBack, conn.name, sub, "trash-2" to { removing = true }) {
        val shown = err ?: conn.error?.takeIf { conn.legacy } ?: cached?.error?.takeIf { it.isNotEmpty() }
        shown?.let { Text(it, if (cached?.stale == true) c.textSecondary else c.danger, 12, Modifier.padding(horizontal = 16.dp, vertical = 6.dp)) }
        LazyColumn(Modifier.weight(1f).fillMaxWidth().padding(horizontal = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            itemsIndexed(state?.workspaces.orEmpty(), key = { _, w -> w.id }) { i, w -> Stagger(i) { WsRow(w) { openWs = w.id } } }
            if (state != null && state.workspaces.isEmpty()) item { Text("还没有工作区", c.textSecondary, 13, Modifier.padding(8.dp)) }
            if (state == null && cached?.error.isNullOrEmpty() && !conn.legacy) item { Text("加载中...", c.textSecondary, 13, Modifier.padding(8.dp)) }
            if (!conn.legacy) item {
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).pressable { picking = true }.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon("plus", c.accent, 18.dp)
                    Spacer(Modifier.width(8.dp))
                    Text("添加工作区", c.accent, 14)
                }
            }
        }
    }
    val ws = state?.workspaces?.firstOrNull { it.id == openWs }
    if (ws != null) WorkspacePage(api, conn.id, ws, { openWs = null }) { reload++ }
    if (picking) AddWorkspacePage(api, conn.id, state?.workspaces?.map { it.path }.orEmpty(), { picking = false }) { picking = false; reload++ }
    if (removing) AlertDialog(
        onDismissRequest = { removing = false },
        title = { androidx.compose.material3.Text("删掉这条接入?") },
        text = { androidx.compose.material3.Text("只删 AIOA 这边的记录; 要让管理令牌失效, 去 hxoa 面板 远程管理 删。") },
        confirmButton = { TextButton({ removing = false; scope.launch { runCatching { api.remove(conn.id) }.onSuccess { onBack() }.onFailure { err = it.message } } }) { androidx.compose.material3.Text("删除", color = c.danger) } },
        dismissButton = { TextButton({ removing = false }) { androidx.compose.material3.Text("取消") } },
    )
}

@Composable
private fun WsRow(w: HxoaWs, onClick: () -> Unit) {
    val c = Aioa.colors
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(c.surface).pressable(onClick).padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Dot(if (w.online > 0) c.success else c.textSecondary)
            Spacer(Modifier.width(8.dp))
            Text(w.name, c.text, 14, Modifier.weight(1f), FontWeight.Medium)
            Text("${w.online}/${w.tokens.size} 在线", c.textSecondary, 12)
        }
        Text(w.path, c.textSecondary, 12)
        Text(listOfNotNull(if (w.exec) "可执行命令" else "只读写文件", if (w.workers) "workers" else "direct", w.branch).joinToString(" · "), c.textSecondary, 12)
    }
}
