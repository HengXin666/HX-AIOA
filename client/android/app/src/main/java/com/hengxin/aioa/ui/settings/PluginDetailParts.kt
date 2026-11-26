package com.hengxin.aioa.ui.settings

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import com.hengxin.aioa.kit.Aioa

// 高危权限的说明: 放行与启用前单独确认
private val RISKY_LABEL = mapOf(
    "ui.webview" to "在 App 里嵌网页",
    "core.replace" to "替换核心功能 (主题, 消息渲染, 推送通道)",
)
private const val NET_PREFIX = "net:"
private const val READ_PREFIX = "data:read:"

fun riskyText(p: String): String = when {
    p.startsWith(NET_PREFIX) -> "服务端访问 ${p.removePrefix(NET_PREFIX)}"
    p.startsWith(READ_PREFIX) -> "读取插件数据 ${p.removePrefix(READ_PREFIX)}"
    else -> RISKY_LABEL[p] ?: p
}

/** 高危权限确认框: 列出每一项, 确认后才执行。 */
@Composable
fun RiskyDialog(name: String, action: String, risky: List<String>, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("$action $name?") },
        text = { Text("它需要这些高危权限:\n" + risky.joinToString("\n") { "· " + riskyText(it) }) },
        confirmButton = { TextButton({ onDismiss(); onConfirm() }) { Text(action, color = Aioa.colors.danger) } },
        dismissButton = { TextButton(onDismiss) { Text("取消") } },
    )
}

/** 它提供的单选扩展点或服务: 本账号可以选它, 或回到管理员默认。 */
@Composable
fun ChoiceGroup(d: PluginDetail, enabled: Boolean, onChoose: (String, String?) -> Unit) {
    if (!d.enabled || d.singles.isEmpty()) return
    SettingsGroup("我的选择", "同一位置有多个插件时, 默认用管理员指定的; 这里只改你自己的账号。") {
        d.singles.forEachIndexed { i, point ->
            if (i > 0) RowDivider()
            val mine = d.choices[point] == d.entry.id
            ActionRow(if (mine) "$point: 已选它, 点此回到默认" else "$point: 改用它", if (mine) "refresh-cw" else "check", enabled = enabled) {
                onChoose(point, if (mine) null else d.entry.id)
            }
        }
    }
}

/** 本账号启用开关; 归整个部署的服务端插件子号只看说明。 */
@Composable
fun EnableGroup(d: PluginDetail, enabled: Boolean, onToggle: (Boolean) -> Unit) {
    if (d.deploy && !d.owner) {
        SettingsGroup("启用") { NoteRow("这个插件的数据属于整个部署, 由主人启用后大家一起用, 你不用单独启用。") }
        return
    }
    val hint = if (d.agentless) "这个插件没有 Agent, 不用安装。停用后它的接口与入口都隐藏, 数据保留, 再启用即恢复。"
    else "只对你的账号生效, 数据归你自己; 群和 Agent 由主人安装。停用后数据保留, 再启用即恢复。"
    SettingsGroup("启用", hint) {
        SwitchRow("启用", d.enabled) { on -> if (enabled) onToggle(on) }
    }
}
