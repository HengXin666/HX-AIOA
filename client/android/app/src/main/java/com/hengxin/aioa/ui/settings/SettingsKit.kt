package com.hengxin.aioa.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.Paragraph
import com.hengxin.aioa.kit.Text

private const val TITLE_SP = 17
private const val ROW_SP = 15
private const val VALUE_SP = 14
private const val HINT_SP = 12
private const val GROUP_SP = 13
private const val DISABLED_ALPHA = 0.4f
private const val CHEVRON_RIGHT = -90f
private val ROW_MIN = 52.dp
private val PAGE_MAX = 680.dp

/** 子页骨架: 顶部标题栏 (返回箭头 + 居中标题), 下面一列分组卡片, 内容限宽居中。 */
@Composable
fun SettingsPageFrame(title: String, onBack: (() -> Unit)?, content: @Composable ColumnScope.() -> Unit) {
    val c = Aioa.colors
    Column(Modifier.fillMaxSize().background(c.background)) {
        TopBar(title, onBack)
        Box(Modifier.fillMaxSize().imePadding(), contentAlignment = Alignment.TopCenter) {
            Column(
                Modifier.widthIn(max = PAGE_MAX).fillMaxWidth().verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(20.dp),
            ) {
                content()
                Spacer(Modifier.height(24.dp))
            }
        }
    }
}

@Composable
private fun TopBar(title: String, onBack: (() -> Unit)?) {
    val c = Aioa.colors
    Box(Modifier.fillMaxWidth().height(52.dp).padding(horizontal = 8.dp), contentAlignment = Alignment.Center) {
        if (onBack != null) {
            Box(
                Modifier.align(Alignment.CenterStart).size(40.dp).clip(CircleShape).clickable(onClick = onBack),
                contentAlignment = Alignment.Center,
            ) { Icon(ICON_CHEVRON, c.text, 22.dp, Modifier.rotate(-CHEVRON_RIGHT)) }
        }
        Text(title, c.text, TITLE_SP, weight = FontWeight.SemiBold)
    }
}

/** 一组设置: 可选小标题, 圆角卡片里若干行 (行间细分隔线), 卡片下方可选说明小字。 */
@Composable
fun SettingsGroup(title: String? = null, footer: String? = null, content: @Composable ColumnScope.() -> Unit) {
    val c = Aioa.colors
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        title?.let { Box(Modifier.padding(start = 16.dp)) { Text(it, c.textSecondary, GROUP_SP) } }
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(Aioa.metrics.radius)).background(c.surface), content = content)
        footer?.let { Box(Modifier.padding(horizontal = 16.dp)) { Paragraph(it, c.textSecondary, HINT_SP) } }
    }
}

/** 行间分隔线, 从文字起点画起, 与 iOS / ChatGPT 的列表一致。 */
@Composable
fun RowDivider(indent: Boolean = true) {
    Box(
        Modifier.padding(start = if (indent) 52.dp else 16.dp).fillMaxWidth().height(0.5.dp)
            .background(Aioa.colors.border),
    )
}

@Composable
private fun RowShell(onClick: (() -> Unit)?, enabled: Boolean = true, content: @Composable RowScope.() -> Unit) {
    val click = if (onClick != null && enabled) Modifier.clickable(onClick = onClick) else Modifier
    Row(
        Modifier.fillMaxWidth().then(click).alpha(if (enabled) 1f else DISABLED_ALPHA)
            .heightIn(min = ROW_MIN).padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) { content() }
}

/** 导航行: 图标 + 标题 + 右侧当前值摘要 + 箭头。 */
@Composable
fun NavRow(icon: String, title: String, value: String = "", selected: Boolean = false, onClick: () -> Unit) {
    val c = Aioa.colors
    Box(Modifier.background(if (selected) c.surfaceAlt else Color.Transparent)) {
        RowShell(onClick) {
            Icon(icon, c.text, 20.dp)
            Box(Modifier.weight(1f)) { Text(title, c.text, ROW_SP) }
            if (value.isNotEmpty()) Box(Modifier.widthIn(max = 160.dp)) { Text(value, c.textSecondary, VALUE_SP) }
            Icon(ICON_CHEVRON, c.textSecondary, 16.dp, Modifier.rotate(CHEVRON_RIGHT))
        }
    }
}

/** 动作行: 点一下执行; danger 时整行红色; 可带右侧状态小字。 */
@Composable
fun ActionRow(title: String, icon: String? = null, value: String = "", danger: Boolean = false, enabled: Boolean = true, onClick: () -> Unit) {
    val c = Aioa.colors
    val tint = if (danger) c.danger else c.text
    RowShell(onClick, enabled) {
        icon?.let { Icon(it, tint, 20.dp) }
        Box(Modifier.weight(1f)) { Text(title, tint, ROW_SP, weight = FontWeight.Medium) }
        if (value.isNotEmpty()) Text(value, c.textSecondary, VALUE_SP)
    }
}

/** 开关行: 标题 + 可选说明 + Switch, 整行可点。 */
@Composable
fun SwitchRow(title: String, checked: Boolean, hint: String? = null, onChange: (Boolean) -> Unit) {
    val c = Aioa.colors
    RowShell({ onChange(!checked) }) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, c.text, ROW_SP)
            hint?.let { Paragraph(it, c.textSecondary, HINT_SP) }
        }
        Switch(
            checked = checked,
            onCheckedChange = onChange,
            colors = SwitchDefaults.colors(
                checkedThumbColor = c.onAccent,
                checkedTrackColor = c.accent,
                uncheckedThumbColor = c.textSecondary,
                uncheckedTrackColor = c.surfaceAlt,
                uncheckedBorderColor = c.border,
            ),
        )
    }
}

/** 信息行: 左标题右值, 不可点; mono 用于版本号, 节点等。 */
@Composable
fun InfoRow(title: String, value: String, valueColor: Color? = null) {
    val c = Aioa.colors
    RowShell(null) {
        Box(Modifier.weight(1f)) { Text(title, c.text, ROW_SP) }
        Box(Modifier.widthIn(max = 220.dp)) { Text(value, valueColor ?: c.textSecondary, VALUE_SP) }
    }
}

/** 多行说明行: 放在卡片内部的状态文字, 例如代理摘要, 报错。 */
@Composable
fun NoteRow(text: String, color: Color? = null, mono: Boolean = false) {
    val c = Aioa.colors
    Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp)) {
        if (mono) {
            androidx.compose.foundation.text.BasicText(
                text,
                style = TextStyle(color = color ?: c.text, fontSize = HINT_SP.sp, fontFamily = FontFamily.Monospace, lineHeight = 17.sp),
            )
        } else Paragraph(text, color ?: c.text, VALUE_SP)
    }
}

/** 输入行: 上方小标签, 下方单行输入; secret 时默认遮住, 右侧可切换显示。 */
@Composable
fun InputRow(label: String, value: String, placeholder: String = "", secret: Boolean = false, onChange: (String) -> Unit) {
    val c = Aioa.colors
    var reveal by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f)) { Text(label, c.textSecondary, HINT_SP) }
            if (secret) {
                Box(Modifier.clip(CircleShape).clickable { reveal = !reveal }.padding(horizontal = 8.dp, vertical = 2.dp)) {
                    Text(if (reveal) TEXT_HIDE else TEXT_SHOW, c.textSecondary, HINT_SP)
                }
            }
        }
        Box(Modifier.fillMaxWidth().height(28.dp), contentAlignment = Alignment.CenterStart) {
            if (value.isEmpty()) Text(placeholder, c.textSecondary.copy(alpha = 0.6f), ROW_SP)
            BasicTextField(
                value = value,
                onValueChange = onChange,
                singleLine = true,
                textStyle = TextStyle(color = c.text, fontSize = ROW_SP.sp),
                cursorBrush = SolidColor(c.text),
                visualTransformation = if (secret && !reveal) PasswordVisualTransformation() else VisualTransformation.None,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

/** 主按钮: 卡片外的整宽胶囊按钮, 用于 "保存并连接" 之类。 */
@Composable
fun PrimaryAction(label: String, enabled: Boolean = true, onClick: () -> Unit) {
    val c = Aioa.colors
    Box(
        Modifier.fillMaxWidth().height(ROW_MIN).clip(RoundedCornerShape(50)).background(c.accent)
            .alpha(if (enabled) 1f else DISABLED_ALPHA)
            .then(if (enabled) Modifier.clickable(onClick = onClick) else Modifier),
        contentAlignment = Alignment.Center,
    ) { Text(label, c.onAccent, ROW_SP, weight = FontWeight.SemiBold) }
}

/** 在线状态点。 */
@Composable
fun StatusDot(on: Boolean) {
    val c = Aioa.colors
    Box(Modifier.size(8.dp).clip(CircleShape).background(if (on) c.success else c.warning))
}
