package com.hengxin.aioa.ui.settings

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.Paragraph
import com.hengxin.aioa.kit.SoftTag
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.ui.OneRow
import kotlinx.coroutines.launch

private const val BODY_SP = 13
private val ICON_BOX = 44.dp
private val TILE = RoundedCornerShape(12.dp)

/** 插件市场: 列表页; 点开一项进详情, 返回键回到列表。openGroup 用来安装后直接进群。 */
@Composable
fun PluginsPage(onBack: (() -> Unit)?, openGroup: (String) -> Unit) {
    var openId by rememberSaveable { mutableStateOf<String?>(null) }
    var sources by rememberSaveable { mutableStateOf(false) }
    // 安装 / 卸载后列表要重拉
    var version by remember { mutableStateOf(0) }
    val id = openId
    if (id != null) {
        BackHandler { openId = null }
        PluginDetailPage(id, { openId = null }, { version++ }, openGroup)
        return
    }
    if (sources) {
        BackHandler { sources = false }
        MarketSourcesPage({ sources = false; version++ })
        return
    }
    val api = PluginApi(LocalContext.current)
    val scope = rememberCoroutineScope()
    var market by remember { mutableStateOf<PluginMarket?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var dev by remember { mutableStateOf<Boolean?>(null) }
    // 收到 plugin_update (放行, 撤销, 启用, 换版本) 就重拉
    val pushed by PluginEvents.rev.collectAsState()
    val compat by PluginEvents.compat.collectAsState()
    LaunchedEffect(version, pushed) {
        api.list().onSuccess { market = it; error = it.warn }.onFailure { error = it.message }
        if (market?.admin == true) api.devMode().onSuccess { dev = it.first }
    }
    val c = Aioa.colors
    SettingsPageFrame(SettingsPage.PLUGINS.title, onBack) {
        Paragraph("插件把一种玩法打包分发: 一个群 + 一个群 Agent (提示词) + 一个工作台面板, 数据归启用它的账号。不在手机上运行代码, 群 Agent 由你自己机器上的 agent harness 或云端来跑。", c.textSecondary, BODY_SP)
        compat?.takeIf { it.level != COMPAT_OK }?.let { SettingsGroup { NoteRow(it.msg ?: "建议更新 App", if (it.limited) c.danger else c.textSecondary) } }
        error?.let { SettingsGroup { NoteRow(it, c.danger) } }
        val items = market?.items
        when {
            items == null && error == null -> Paragraph("加载中...", c.textSecondary, BODY_SP)
            items.isNullOrEmpty() -> if (error == null) Paragraph("市场里还没有插件", c.textSecondary, BODY_SP)
            else -> {
                val devs = items.filter { it.dev }
                val (mine, rest) = items.filterNot { it.dev }.partition { it.mine }
                if (devs.isNotEmpty()) PluginGroup("开发中", devs) { openId = it }
                if (mine.isNotEmpty()) PluginGroup(if (market?.owner == true) "已安装" else "已启用", mine) { openId = it }
                val (official, third) = rest.partition { it.sourceName == null }
                if (official.isNotEmpty()) PluginGroup("官方市场", official) { openId = it }
                // 第三方源按源分组, 顺序与市场源页一致
                third.groupBy { it.sourceName!! }.forEach { (name, list) -> PluginGroup("第三方: $name", list) { openId = it } }
            }
        }
        if (market?.admin == true) {
            SettingsGroup(footer = "加别的 GitHub 仓库作为市场。第三方插件同样要逐个放行, 不能用官方命名空间, 不能带服务端代码。") {
                ActionRow("市场源", "globe") { sources = true }
            }
        }
        dev?.let { on ->
            SettingsGroup("开发模式", "只在你自己的账号上试本地插件 (不带服务端代码), 别人看不到。用 tools/plugin-dev.mjs 把插件目录传上来; 关掉时开发插件全部撤掉。") {
                SwitchRow("开发模式", on) { next ->
                    scope.launch { api.setDevMode(next).onSuccess { dev = next; version++ }.onFailure { error = it.message } }
                }
            }
        }
    }
}

private const val COMPAT_OK = "ok"

@Composable
private fun PluginGroup(title: String, list: List<PluginEntry>, open: (String) -> Unit) {
    SettingsGroup(title) { list.forEachIndexed { i, p -> if (i > 0) RowDivider(); PluginTile(p) { open(p.id) } } }
}

@Composable
fun PluginIcon(name: String) {
    val c = Aioa.colors
    Box(Modifier.size(ICON_BOX).clip(TILE).background(c.accent.copy(alpha = 0.12f)), contentAlignment = Alignment.Center) {
        Icon(name, c.accent, 22.dp)
    }
}

@Composable
private fun PluginTile(p: PluginEntry, onClick: () -> Unit) {
    val c = Aioa.colors
    // 一行一条 (#138): 图标, 名字, 版本与来源压到右边, 最右状态标签; 次行补回简介与标签 (#139)
    val state: Pair<String, Color>? = when {
        p.foreign -> "别人开发中" to c.textSecondary
        p.dev -> "开发中" to c.accent
        p.outdated -> "可更新到 v${p.allowed?.version}" to c.accent
        p.installed != null -> "已安装" to c.success
        p.enabled -> "已启用" to c.success
        p.allowed == null -> "待放行" to c.textSecondary
        else -> null
    }
    val meta = listOfNotNull("v${p.installed?.version ?: p.version}", p.sourceName).joinToString(" · ")
    val sub = listOf(p.summary, p.tags.joinToString(" ") { "#$it" }).filter { it.isNotBlank() }.joinToString("\n")
    OneRow(p.icon, p.name, meta, c.accent, pad = 16, onClick = onClick, sub = sub) { state?.let { (t, tone) -> SoftTag(t, tone) } }
}
