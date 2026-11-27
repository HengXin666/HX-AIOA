package com.hengxin.aioa.ui

import com.hengxin.aioa.kit.AnimatedItems
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.Constants
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Card
import com.hengxin.aioa.kit.CardState
import com.hengxin.aioa.kit.Chip
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.Paragraph
import com.hengxin.aioa.kit.SettingRow
import com.hengxin.aioa.kit.StateBody
import com.hengxin.aioa.kit.Text
import androidx.compose.material3.Text as MText

private const val TITLE_SP = 22
private const val BODY_SP = 14
private const val HINT_SP = 12
private const val TITLE = "数据源"

/** 我的 → 数据源: 列表, 添加, 新建后的接入说明。返回键逐级回退, 列表页再交给上一层。 */
@Composable
fun SourcesPage(state: SourcesState, onBack: () -> Unit) {
    LaunchedEffect(Unit) { state.refresh() }
    // 添加 / 结果页退回列表; 列表页的返回交给 "我的" (手机回列表, 宽屏交给外层), 不在这里截
    BackHandler(enabled = state.screen != SourcesScreen.LIST) { state.back() }
    when (state.screen) {
        SourcesScreen.LIST -> SourceList(state, onBack)
        SourcesScreen.ADD -> SourceAdd(state)
        SourcesScreen.RESULT -> SourceResult(state)
    }
}

/** 子页骨架: 左侧返回, 标题, 右上角可选动作。 */
@Composable
fun SubPage(title: String, onBack: () -> Unit, action: Pair<String, () -> Unit>? = null, content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(Aioa.metrics.gap),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Chip("返回", false, onBack)
            Box(Modifier.weight(1f)) { Text(title, Aioa.colors.text, TITLE_SP) }
            action?.let { (label, run) -> Chip(label, true, run) }
        }
        content()
        Spacer(Modifier.height(8.dp))
    }
}

@Composable
private fun SourceList(state: SourcesState, onBack: () -> Unit) {
    var showing by remember { mutableStateOf<SourceItem?>(null) }
    SubPage(TITLE, onBack, "添加" to { state.startAdd() }) {
        state.error?.let { ErrorCard(it) }
        if (state.items.isEmpty()) {
            Card { StateBody(if (state.loaded) CardState.Empty else CardState.Loading, "还没有数据源, 点添加接入 GitHub 等") {} }
        } else {
            Card {
                AnimatedItems(state.items.toList(), { it.id }) { s ->
                    SourceRow(s, state.typeOf(s)) { showing = s }
                }
            }
            Text("点按或长按查看详情与删除", Aioa.colors.textSecondary, HINT_SP)
        }
    }
    showing?.let { s -> SourceDetail(s, state.typeOf(s), { showing = null }) { state.delete(s); showing = null } }
}

@Composable
private fun SourceRow(s: SourceItem, kind: SourceType?, open: () -> Unit) {
    // 一行一条 (#138): 图标, 名字, subject 压到右边, 最右类型
    OneRow(s.icon ?: kind?.icon ?: s.type, s.name, s.subject.orEmpty(), onLongClick = open, onClick = open) {
        Text(kind?.name ?: s.type, Aioa.colors.textSecondary, HINT_SP)
    }
}

@Composable
private fun SourceDetail(s: SourceItem, kind: SourceType?, close: () -> Unit, delete: () -> Unit) {
    var confirm by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = close,
        title = { MText(s.name) },
        text = {
            val lines = listOfNotNull("类型: ${kind?.name ?: s.type}", s.subject?.let { "subject: $it" }, "id: ${s.id}")
            MText(if (confirm) "删除后它的 key 立即失效, 外部系统再推送会被拒绝。确定删除?" else lines.joinToString("\n"))
        },
        confirmButton = {
            TextButton(onClick = { if (confirm) delete() else confirm = true }) { MText(if (confirm) "确定删除" else "删除") }
        },
        dismissButton = { TextButton(onClick = close) { MText("关闭") } },
    )
}

@Composable
private fun SourceAdd(state: SourcesState) {
    var picked by remember { mutableStateOf<SourceType?>(null) }
    LaunchedEffect(state.addType, state.types) {
        val want = state.addType ?: return@LaunchedEffect
        state.types.firstOrNull { it.type == want }?.let { picked = it; state.addType = null }
    }
    SubPage("添加数据源", { state.back() }) {
        state.error?.let { ErrorCard(it) }
        val kind = picked
        if (kind == null) {
            if (state.types.isEmpty()) {
                Card { StateBody(if (state.loaded) CardState.Error("拉取类型失败") else CardState.Loading, onRetry = state::refresh) {} }
            } else {
                Card { state.types.forEach { t -> SettingRow(t.icon, t.name, t.type) { picked = t } } }
            }
        } else {
            AddForm(state, kind) { picked = null }
        }
    }
}

@Composable
private fun AddForm(state: SourcesState, kind: SourceType, repick: () -> Unit) {
    val github = kind.type == Constants.SOURCE_GITHUB
    var name by remember(kind) { mutableStateOf(if (github) "GitHub" else kind.name) }
    var subject by remember(kind) { mutableStateOf("") }
    Card {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Icon(kind.icon, Aioa.colors.textSecondary)
            Box(Modifier.weight(1f)) { Text(kind.name, Aioa.colors.text, 15) }
            Chip("换类型", false, repick)
        }
        kind.setup?.let { Paragraph(it, Aioa.colors.textSecondary, HINT_SP) }
        OutlinedTextField(name, { name = it }, Modifier.fillMaxWidth(), label = { MText("名称") }, singleLine = true)
        OutlinedTextField(
            subject,
            { subject = it },
            Modifier.fillMaxWidth(),
            label = { MText(if (github) "仓库 owner/repo (可选)" else "subject (可选)") },
            placeholder = { MText(if (github) "例如 octocat/hello-world" else "主机名, 服务名等") },
            singleLine = true,
        )
        if (github) Paragraph("填了 owner/repo, 下一步可以一键打开该仓库的 Webhook 设置页。", Aioa.colors.textSecondary, HINT_SP)
        Button(onClick = { state.create(kind, name, subject) }, enabled = name.isNotBlank() && !state.busy) {
            MText(if (state.busy) "创建中..." else "创建")
        }
    }
}

@Composable
fun ErrorCard(text: String) {
    Card {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon("alert-triangle", Aioa.colors.danger, 16.dp)
            Paragraph(text, Aioa.colors.danger, BODY_SP)
        }
    }
}
