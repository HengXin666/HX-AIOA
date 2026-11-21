package com.hengxin.aioa.kit

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/** 可选主题色, null 表示极简默认 (黑白)。 */
val ACCENT_CHOICES: List<Color?> = listOf(null, Color(0xFF10A37F), Color(0xFF3A7BF6), Color(0xFFD97757), Color(0xFFA86BFF))
val RADIUS_CHOICES = listOf(8, 12, 16, 20, 24)

private val PILL = RoundedCornerShape(50)

/** 一组带小标题的横排控件。 */
@Composable
fun Group(title: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, Aioa.colors.textSecondary, 12)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) { content() }
    }
}

@Composable
fun Chip(label: String, selected: Boolean, onClick: () -> Unit) {
    val c = Aioa.colors
    Box(
        Modifier.pressable(onClick).clip(PILL).background(if (selected) c.accent else c.surfaceAlt)
            .padding(horizontal = 12.dp, vertical = 6.dp),
    ) { Text(label, if (selected) c.onAccent else c.text, 13) }
}

/** 设置页里的一行: 图标, 标题, 右侧说明, 可点。 */
@Composable
fun SettingRow(icon: String, title: String, hint: String = "", onClick: (() -> Unit)? = null) {
    val c = Aioa.colors
    Row(
        Modifier.fillMaxWidth().pressable(onClick).padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(icon, c.textSecondary)
        Box(Modifier.weight(1f)) { Text(title, c.text, 15) }
        if (hint.isNotEmpty()) Text(hint, c.textSecondary, 13)
    }
}

/** 主题色, 圆角, 密度的编辑器; 明暗由调用方决定 (应用里还有 "跟随系统")。 */
@Composable
fun AppearanceEditor(a: Appearance, set: (Appearance) -> Unit) {
    val c = Aioa.colors
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Group("主题色") {
            ACCENT_CHOICES.forEach { color ->
                Box(
                    Modifier.size(28.dp).clip(CircleShape).background(color ?: c.text)
                        .border(if (a.accent == color) 3.dp else 0.dp, c.textSecondary, CircleShape)
                        .pressable { set(a.copy(accent = color)) },
                )
            }
        }
        Group("圆角") { RADIUS_CHOICES.forEach { r -> Chip("$r", a.radius == r.dp) { set(a.copy(radius = r.dp)) } } }
        Group("密度") {
            Chip("标准", !a.compact) { set(a.copy(compact = false)) }
            Chip("紧凑", a.compact) { set(a.copy(compact = true)) }
        }
        Chip("恢复默认", false) { set(Appearance(dark = a.dark)) }
    }
}
