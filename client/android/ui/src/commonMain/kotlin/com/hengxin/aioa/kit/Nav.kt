package com.hengxin.aioa.kit

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

data class NavItem(val key: String, val label: String, val icon: String)

private val CONTENT_MAX = 1040.dp

/** 应用骨架: 手机底部导航, 平板左侧导航栏, 大屏内容限宽居中。 */
@Composable
fun AppScaffold(items: List<NavItem>, selected: String, onSelect: (String) -> Unit, content: @Composable () -> Unit) {
    val c = Aioa.colors
    Adaptive(Modifier.fillMaxSize().background(c.background)) {
        if (LocalWidthClass.current == WidthClass.Compact) {
            Column(Modifier.fillMaxSize()) {
                Box(Modifier.weight(1f).fillMaxWidth()) { content() }
                Row(Modifier.fillMaxWidth().background(c.background).padding(vertical = 8.dp)) {
                    items.forEach { NavButton(it, it.key == selected, Modifier.weight(1f), onSelect) }
                }
            }
        } else {
            Row(Modifier.fillMaxSize()) {
                Column(
                    Modifier.width(84.dp).fillMaxHeight().background(c.surface).padding(vertical = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) { items.forEach { NavButton(it, it.key == selected, Modifier.fillMaxWidth(), onSelect) } }
                Box(Modifier.weight(1f).fillMaxHeight(), contentAlignment = Alignment.TopCenter) {
                    Box(Modifier.widthIn(max = CONTENT_MAX)) { content() }
                }
            }
        }
    }
}

@Composable
private fun NavButton(item: NavItem, active: Boolean, modifier: Modifier, onSelect: (String) -> Unit) {
    val c = Aioa.colors
    val tint = if (active) c.text else c.textSecondary
    Column(modifier.pressable { onSelect(item.key) }.padding(vertical = 4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(item.icon, tint, 22.dp)
        Text(item.label, tint, 11)
    }
}
