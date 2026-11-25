package com.hengxin.aioa.ui.settings

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.Paragraph
import com.hengxin.aioa.kit.Text

private const val NAME_SP = 16
private const val SMALL_SP = 12
private const val BODY_SP = 13
private val ICON_BOX = 44.dp
private val TILE = RoundedCornerShape(12.dp)

/** 插件市场: 列表页; 点开一项进详情, 返回键回到列表。openGroup 用来安装后直接进群。 */
@Composable
fun PluginsPage(onBack: (() -> Unit)?, openGroup: (String) -> Unit) {
    var openId by rememberSaveable { mutableStateOf<String?>(null) }
    // 安装 / 卸载后列表要重拉
    var version by remember { mutableStateOf(0) }
    val id = openId
    if (id != null) {
        BackHandler { openId = null }
        PluginDetailPage(id, { openId = null }, { version++ }, openGroup)
        return
    }
    val api = PluginApi(LocalContext.current)
    var list by remember { mutableStateOf<List<PluginEntry>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(version) {
        api.list().onSuccess { (items, warn) -> list = items; error = warn }.onFailure { error = it.message }
    }
    val c = Aioa.colors
    SettingsPageFrame(SettingsPage.PLUGINS.title, onBack) {
        Paragraph("插件把一种玩法打包分发: 一个群 + 一个接入的 Agent (提示词) + 一个工作台面板。不在手机上运行代码, Agent 跑在你自己的机器上。", c.textSecondary, BODY_SP)
        error?.let { SettingsGroup { NoteRow(it, c.danger) } }
        val items = list
        when {
            items == null && error == null -> Paragraph("加载中...", c.textSecondary, BODY_SP)
            items.isNullOrEmpty() -> if (error == null) Paragraph("市场里还没有插件", c.textSecondary, BODY_SP)
            else -> {
                val (mine, rest) = items.partition { it.installed != null }
                if (mine.isNotEmpty()) SettingsGroup("已安装") { mine.forEachIndexed { i, p -> if (i > 0) RowDivider(); PluginTile(p) { openId = p.id } } }
                if (rest.isNotEmpty()) SettingsGroup("官方市场") { rest.forEachIndexed { i, p -> if (i > 0) RowDivider(); PluginTile(p) { openId = p.id } } }
            }
        }
    }
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
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        PluginIcon(p.icon)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(p.name, c.text, NAME_SP, weight = FontWeight.SemiBold)
                Text("v${p.installed?.version ?: p.version}", c.textSecondary, SMALL_SP)
                if (p.outdated) Text("可更新到 v${p.allowed?.version}", c.accent, SMALL_SP)
                else if (p.installed != null) Text("已安装", c.success, SMALL_SP)
                else if (p.allowed == null) Text("待放行", c.textSecondary, SMALL_SP)
            }
            if (p.summary.isNotEmpty()) Paragraph(p.summary, c.textSecondary, BODY_SP, maxLines = 2)
            if (p.tags.isNotEmpty()) Text(p.tags.joinToString("  ") { "#$it" }, c.accent, SMALL_SP)
        }
    }
}
