package com.hengxin.aioa.ui.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.R
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.net.NodeInfo
import com.hengxin.aioa.ui.SettingsModel

private const val MAX_NODES_SHOWN = 30
private const val NODE_SP = 15
private const val META_SP = 12

/** 服务端: 地址, 令牌, 保存并连接, 当前连接状态。 */
@Composable
fun ServerPage(model: SettingsModel, online: Boolean, onSaved: () -> Unit, onBack: (() -> Unit)?) {
    SettingsPageFrame(SettingsPage.SERVER.title, onBack) { ServerFields(model, online, onSaved) }
}

/** 服务端表单本体, 首次配置页也复用它。 */
@Composable
fun ColumnScope.ServerFields(model: SettingsModel, online: Boolean?, onSaved: () -> Unit, withSave: Boolean = true) {
    val c = Aioa.colors
    SettingsGroup("服务端", "地址和令牌只保存在本机, 不会上传或打进安装包。") {
        InputRow("服务端地址", model.server, "https://aioa.example.com") { model.server = it }
        RowDivider(false)
        InputRow("令牌", model.token, "必填", secret = true) { model.token = it }
    }
    if (withSave) PrimaryAction(stringResource(R.string.action_save)) { if (model.save()) onSaved() }
    if (online != null) {
        SettingsGroup(TEXT_STATUS) {
            val text = stringResource(if (online) R.string.status_online else R.string.status_offline)
            InfoRow("消息通道", text, if (online) c.success else c.warning)
        }
    }
    if (model.proxyMessage.isNotEmpty()) SettingsGroup { NoteRow(model.proxyMessage, c.textSecondary) }
}

/** 代理: 订阅与长连接开关 (保存), 内核状态, 操作, 节点列表。 */
@Composable
fun ProxyPage(model: SettingsModel, onSaved: () -> Unit, onBack: (() -> Unit)?) {
    val c = Aioa.colors
    val view = model.proxy
    SettingsPageFrame(SettingsPage.PROXY.title, onBack) {
        ProxyFields(model, onSaved)
        SettingsGroup(TEXT_STATUS) {
            NoteRow(view.summary.ifEmpty { "读取中..." })
            if (view.subStatus.isNotEmpty()) {
                RowDivider(false)
                NoteRow(view.subStatus, c.textSecondary)
            }
            view.errors.forEach {
                RowDivider(false)
                NoteRow(it, c.danger)
            }
            if (model.proxyMessage.isNotEmpty()) {
                RowDivider(false)
                NoteRow(model.proxyMessage, c.textSecondary)
            }
        }
        SettingsGroup("操作") {
            ActionRow(stringResource(R.string.action_optimize), "gauge", enabled = view.running && !model.proxyBusy, onClick = model::optimize)
            RowDivider()
            ActionRow(stringResource(R.string.action_refresh_sub), ICON_REFRESH, enabled = !model.proxyBusy, onClick = model::refreshSubscription)
            RowDivider()
            ActionRow(stringResource(R.string.action_refresh), "activity", onClick = model::refreshProxy)
        }
        if (view.nodes.isNotEmpty()) NodeGroup(model)
    }
}

/** 订阅链接与 "长连接走代理" 开关, 首次配置页也复用。 */
@Composable
fun ColumnScope.ProxyFields(model: SettingsModel, onSaved: () -> Unit, withSave: Boolean = true) {
    SettingsGroup("订阅", "留空订阅则全部直连。保存后会在后台启动代理内核并拉取订阅。") {
        InputRow("订阅链接", model.subscription, "留空则直连") { model.subscription = it }
        RowDivider(false)
        SwitchRow(stringResource(R.string.proxy_link), model.proxyLink, "关闭时消息长连接直连, 更新下载仍按内核状态走代理") { model.proxyLink = it }
    }
    if (withSave) PrimaryAction("保存并应用") { if (model.save()) onSaved() }
}

@Composable
private fun NodeGroup(model: SettingsModel) {
    val view = model.proxy
    val more = view.nodes.size - MAX_NODES_SHOWN
    val footer = stringResource(R.string.node_tap_hint) + if (more > 0) "。" + stringResource(R.string.node_more, more) else ""
    SettingsGroup("节点 (${view.nodes.size})", footer) {
        view.nodes.take(MAX_NODES_SHOWN).forEachIndexed { i, node ->
            if (i > 0) RowDivider(false)
            NodeRow(node, node.name == view.current, !model.proxyBusy) { model.choose(node) }
        }
    }
}

@Composable
private fun NodeRow(node: NodeInfo, selected: Boolean, enabled: Boolean, onClick: () -> Unit) {
    val c = Aioa.colors
    Row(
        Modifier.fillMaxWidth().clickable(enabled = enabled, onClick = onClick).heightIn(min = 48.dp)
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(Modifier.size(18.dp)) { if (selected) Icon(ICON_CHECK, c.success, 18.dp) }
        Box(Modifier.weight(1f)) { Text(node.name, c.text, NODE_SP) }
        Text(node.type, c.textSecondary, META_SP)
        val delay = if (node.delayMs > 0) "${node.delayMs} ms" else "--"
        Text(delay, if (node.delayMs > 0) c.text else c.textSecondary, META_SP)
    }
}

/** 连接日志: 第一行是计数摘要, 下面是长连接的连接, 断开, 重连记录。 */
@Composable
fun LinkLogPage(model: SettingsModel, onBack: (() -> Unit)?) {
    val c = Aioa.colors
    val log = model.proxy.linkLog
    SettingsPageFrame(SettingsPage.LINK_LOG.title, onBack) {
        SettingsGroup { ActionRow(TEXT_REFRESH, ICON_REFRESH, onClick = model::refreshProxy) }
        SettingsGroup(
            "记录 (最新在前)",
            "第一行是连接与唤醒计数 (对照耗电测量用), 下面是后台长连接的连接, 断开, 重连记录。排查断线不重连时看这里。",
        ) {
            if (log.isEmpty()) NoteRow("暂无记录", c.textSecondary)
            log.forEachIndexed { i, line ->
                if (i > 0) RowDivider(false)
                NoteRow(line, mono = true)
            }
        }
    }
}
