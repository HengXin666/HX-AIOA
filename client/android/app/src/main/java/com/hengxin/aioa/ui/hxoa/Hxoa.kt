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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Dot
import com.hengxin.aioa.kit.HomeRow
import com.hengxin.aioa.kit.HomeSection
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.pressable
import kotlinx.coroutines.launch

// hxoa 管理 (插件 hengxin666.hxoa, 现由主人私有源提供, #124 #142): "工作区" 页 (agent harness, #144) 里的 hxoa 分组 (home-spaces §3 区块),
// 点开是全屏的 列表 → 一台 hxoa → 工作区 / 添加工作区 (页面栈见 HxoaHost.kt)。
// 列表先显示本机缓存 (内存 → 磁盘), 后台刷新; 各项自上而下逐个渐显 (#108)。

private const val STAGGER_MS = 45
private const val FADE_MS = 220
internal const val HXOA_ICON = "terminal"

/** 自上而下逐项渐显: 第 index 项晚 index * STAGGER_MS 出现。 */
@Composable
internal fun Stagger(index: Int, content: @Composable () -> Unit) {
    val state = remember { MutableTransitionState(false).apply { targetState = true } }
    AnimatedVisibility(state, enter = fadeIn(tween(FADE_MS, index * STAGGER_MS)) + slideInVertically(tween(FADE_MS, index * STAGGER_MS)) { it / 4 }) { content() }
}

/** 页面栈里的一页: 顶栏 (返回, 标题, 副标题, 右侧按钮) + 内容; 外面只有一层全屏窗口 ([HxoaHost])。 */
@Composable
internal fun FullPage(onBack: () -> Unit, title: String, sub: String, action: Pair<String, () -> Unit>? = null, content: @Composable ColumnScope.() -> Unit) {
    val c = Aioa.colors
    Column(Modifier.fillMaxSize().background(c.background)) {
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

/** 一台 hxoa 的状态说明: 在线时是版本, 旧版接入要重接, 否则离线。 */
internal fun connHint(conn: HxoaConn): String = if (conn.legacy) "需重新接入" else conn.server ?: "离线"

/**
 * "工作区" 页的 hxoa 分组: 每台的在线状态与版本, 点一台进它的工作区, "全部" 进列表页。
 * 主人没启用插件 (接口 404 / 403) 时整组不显示; 页面也挂着 hxoa 的全屏页 (侧栏入口同样打开它)。
 */
@Composable
fun HxoaSection() {
    HxoaGate.load(LocalContext.current)
    HxoaHost()
    val view = rememberConns()
    val list = view.list ?: return
    var adding by remember { mutableStateOf(false) }
    val c = Aioa.colors
    HomeSection("hxoa", count = list.count { it.online }, action = "全部", onAction = HxoaNav::openList) {
        list.forEachIndexed { i, conn ->
            HomeRow(conn.name, connHint(conn), divider = i > 0, lead = { StatusDot(conn) }, onClick = { HxoaNav.open(HxoaRoute.Conn(conn.id)) })
        }
        HomeRow("接入 hxoa", "地址 + 管理令牌", divider = list.isNotEmpty(), lead = { Icon("plus", c.accent, 18.dp) }, onClick = { adding = true })
    }
    if (adding) AddConnDialog(HxoaApi(LocalContext.current.applicationContext), { adding = false }) { adding = false; HxoaNav.changed() }
}

@Composable
internal fun StatusDot(conn: HxoaConn) {
    val c = Aioa.colors
    Box(Modifier.size(18.dp), contentAlignment = Alignment.Center) { Dot(if (conn.online) c.success else if (conn.legacy) c.danger else c.textSecondary) }
}

@Composable
internal fun AddConnDialog(api: HxoaApi, onDismiss: () -> Unit, onDone: () -> Unit) {
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
                androidx.compose.material3.Text("在 hxoa 面板 远程管理 里建 (需 2.4.1+)。令牌只存在服务端, 加密保存。", fontSize = 12.sp, color = Aioa.colors.textSecondary)
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

@Composable
internal fun WsRow(w: HxoaWs, onClick: () -> Unit) {
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
