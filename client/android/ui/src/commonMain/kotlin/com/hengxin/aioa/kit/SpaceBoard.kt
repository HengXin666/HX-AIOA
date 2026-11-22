package com.hengxin.aioa.kit

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

private const val OFF_ALPHA = 0.3f
private const val SECONDS_PER_MINUTE = 60
private val PANEL_MIN_CELL = 170.dp
private val ITEM_MIN_CELL = 130.dp

// 窄组件 (数值, 环形, 按钮) 并排, 其余占满面板宽度
private val NARROW = setOf(ItemType.VALUE, ItemType.SPARKLINE, ItemType.RING, ItemType.BUTTON)
private const val WIDE_SPAN = 99

/**
 * 工作台: 顶部切换多个工作台, 编辑模式下可移动面板与调整宽度。
 * 布局变化通过 handler.layout 交给调用方保存, 与 Web 端同一份 schema 与同一套组件。
 */
@Composable
fun SpaceBoard(
    spaces: List<Space>,
    currentId: String?,
    editing: Boolean,
    source: SpaceSource,
    handler: SpaceHandler,
    onPick: (String) -> Unit,
    onEdit: (Boolean) -> Unit,
) {
    val c = Aioa.colors
    val shown = spaces.filter { !it.layout.hidden }
    if (shown.isEmpty()) {
        Card { StateBody(if (source.ready) CardState.Empty else CardState.Loading, "还没有工作台, Agent 可通过接口下发") {} }
        return
    }
    val cur = shown.firstOrNull { it.id == currentId } ?: shown.first()
    Row(verticalAlignment = Alignment.CenterVertically) {
        Row(Modifier.weight(1f).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            shown.forEach { s -> Chip(s.title, s.id == cur.id) { onPick(s.id) } }
        }
        Spacer(Modifier.width(8.dp))
        Chip(if (editing) "完成" else "编辑布局", editing) { onEdit(!editing) }
    }
    val panels = cur.orderedPanels()
    AdaptiveGrid(panels, minCell = PANEL_MIN_CELL, span = { cur.sizeOf(it).span }, maxCols = PanelSize.Full.span) { panel ->
        PanelCard(cur, panel, panels, editing, source, handler)
    }
    if (editing) Text("箭头调整顺序, 缩放图标调整面板宽度", c.textSecondary, 12)
}

@Composable
private fun PanelCard(space: Space, panel: SpacePanel, panels: List<SpacePanel>, editing: Boolean, source: SpaceSource, handler: SpaceHandler) {
    val c = Aioa.colors
    Card {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(panel.icon ?: "layout-dashboard", c.textSecondary, 16.dp)
            Spacer(Modifier.width(6.dp))
            Text(panel.title, c.text, 15, Modifier.weight(1f), FontWeight.SemiBold)
            Text(panel.everySec?.let { "每 ${it / SECONDS_PER_MINUTE} 分钟" } ?: "实时", c.textSecondary, 11)
        }
        // 工具单独一行, 最窄的面板也放得下标题
        if (editing) Tools(space, panel, panels, handler)
        AdaptiveGrid(panel.items, minCell = ITEM_MIN_CELL, span = { if (it.type in NARROW) 1 else WIDE_SPAN }) { item ->
            Column(Modifier.padding(vertical = 2.dp)) { SpaceItemView(space, panel, item, source, handler) }
        }
    }
}

@Composable
private fun Tools(space: Space, panel: SpacePanel, panels: List<SpacePanel>, handler: SpaceHandler) {
    val c = Aioa.colors
    val i = panels.indexOf(panel)
    val size = space.sizeOf(panel)
    fun move(to: Int) {
        if (to < 0 || to > panels.lastIndex) return
        val ids = panels.map { it.id }.toMutableList()
        ids.add(to, ids.removeAt(i))
        handler.layout(space, LayoutChange.Order(ids))
    }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Tool("chevron-up", i > 0) { move(i - 1) }
        Tool("chevron-down", i < panels.lastIndex) { move(i + 1) }
        Tool("minimize-2", size != PanelSize.S) { handler.layout(space, LayoutChange.Size(panel.id, size.step(-1))) }
        Text(size.label, c.textSecondary, 11)
        Tool("maximize-2", size != PanelSize.Full) { handler.layout(space, LayoutChange.Size(panel.id, size.step(1))) }
    }
}

@Composable
private fun Tool(icon: String, enabled: Boolean, onClick: () -> Unit) {
    Icon(icon, Aioa.colors.text, 18.dp, Modifier.alpha(if (enabled) 1f else OFF_ALPHA).pressable(if (enabled) onClick else null).padding(2.dp))
}
