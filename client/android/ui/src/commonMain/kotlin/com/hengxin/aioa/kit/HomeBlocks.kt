package com.hengxin.aioa.kit

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

private val GROUP_SHAPE = RoundedCornerShape(16.dp)
private const val LEAD = 36
private val LEAD_INSET = (14 + LEAD + 12).dp

/** 空间顶部的一句话概况: 小字日期, 大字结论, 一行补充。 */
@Composable
fun SpaceHeader(kicker: String, title: String, sub: String) {
    val c = Aioa.colors
    Column(Modifier.fillMaxWidth().padding(start = 4.dp, top = 18.dp, bottom = 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(kicker, c.textSecondary, 13)
        Text(title, c.text, 24, weight = FontWeight.SemiBold)
        Text(sub, c.textSecondary, 14)
    }
}

/** 一格数字 (几格并排放在概况下面)。 */
@Composable
fun StatTile(icon: String, value: String, label: String, modifier: Modifier = Modifier) {
    val c = Aioa.colors
    Column(
        modifier.clip(RoundedCornerShape(14.dp)).background(groupBg()).border(1.dp, c.border.copy(alpha = 0.6f), RoundedCornerShape(14.dp))
            .pointerTap {}.padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(icon, c.textSecondary, 16.dp)
        Text(value, c.text, 20, weight = FontWeight.SemiBold)
        Text(label, c.textSecondary, 12)
    }
}

@Composable
private fun groupBg(): Color = if (Aioa.tokens.dark) Aioa.colors.surface else Aioa.colors.background

/** 分组小标题: 标题, 数字, 右边 "全部 >" 这类动作。 */
@Composable
fun SectionTitle(title: String, count: Int = 0, strong: Boolean = false, action: String = "", onAction: () -> Unit = {}) {
    val c = Aioa.colors
    Row(
        Modifier.fillMaxWidth().padding(start = 4.dp, end = 2.dp, top = 24.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(title, c.text, 15, weight = FontWeight.SemiBold)
        if (count > 0) CountChip(count, strong)
        Spacer(Modifier.weight(1f))
        if (action.isNotEmpty()) {
            Row(Modifier.clip(RoundedCornerShape(8.dp)).pointerTap(onAction).padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(action, c.textSecondary, 13)
                Icon("chevron-right", c.textSecondary, 14.dp)
            }
        }
    }
}

/** 总览里的一组: 小标题在外, 行在一张描边圆角卡里, 行间细线 (分组列表)。 */
@Composable
fun HomeSection(
    title: String,
    count: Int = 0,
    strong: Boolean = false,
    action: String = "",
    onAction: () -> Unit = {},
    content: @Composable ColumnScope.() -> Unit,
) {
    val c = Aioa.colors
    SectionTitle(title, count, strong, action, onAction)
    Column(
        Modifier.fillMaxWidth().clip(GROUP_SHAPE).background(groupBg()).border(1.dp, c.border.copy(alpha = 0.6f), GROUP_SHAPE),
        content = content,
    )
}

/** 组里的一行: 左图标或头像, 标题与说明, 右边时间与附件; extra 放在文字下面 (按钮, 进度, 走势)。 */
@Composable
fun HomeRow(
    title: String,
    sub: String = "",
    trail: String = "",
    divider: Boolean = false,
    lead: (@Composable () -> Unit)? = null,
    end: (@Composable () -> Unit)? = null,
    extra: (@Composable ColumnScope.() -> Unit)? = null,
) {
    val c = Aioa.colors
    Column(Modifier.fillMaxWidth().pointerTap {}) {
        if (divider) {
            Box(Modifier.padding(start = if (lead != null) LEAD_INSET else 14.dp).fillMaxWidth().height(1.dp).background(c.border.copy(alpha = 0.5f)))
        }
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            lead?.invoke()
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(title, c.text, 15, weight = FontWeight.Medium)
                if (sub.isNotEmpty()) Text(sub, c.textSecondary, 13)
            }
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(5.dp)) {
                if (trail.isNotEmpty()) Text(trail, c.textSecondary, 12)
                end?.invoke()
            }
        }
        if (extra != null) {
            Column(Modifier.padding(start = if (lead != null) LEAD_INSET else 14.dp, end = 14.dp, bottom = 12.dp), content = extra)
        }
    }
}

/** 行首图标底: 圆角方块, 不用正圆。 */
@Composable
fun Glyph(icon: String, tint: Color = Aioa.colors.text) {
    Box(Modifier.size(LEAD.dp).clip(RoundedCornerShape(10.dp)).background(Aioa.colors.surfaceAlt), contentAlignment = Alignment.Center) {
        Icon(icon, tint, 18.dp)
    }
}

/** 小标签: 语义色的淡底 + 同色字。 */
@Composable
fun SoftTag(text: String, tone: Color) {
    Text(text, tone, 11, Modifier.clip(RoundedCornerShape(6.dp)).background(tone.copy(alpha = 0.14f)).padding(horizontal = 6.dp, vertical = 2.dp), weight = FontWeight.Medium)
}

/** 细进度条。 */
@Composable
fun ProgressLine(fraction: Float, modifier: Modifier = Modifier) {
    val c = Aioa.colors
    Box(modifier.fillMaxWidth().height(4.dp).clip(RoundedCornerShape(2.dp)).background(c.surfaceAlt)) {
        Box(Modifier.fillMaxWidth(fraction.coerceIn(0f, 1f)).height(4.dp).clip(RoundedCornerShape(2.dp)).background(c.text))
    }
}

/** 待办前的方框 (圆角方块, 做完是实心勾)。 */
@Composable
fun CheckBox(done: Boolean) {
    val c = Aioa.colors
    Box(Modifier.size(LEAD.dp), contentAlignment = Alignment.Center) {
        Box(
            Modifier.size(20.dp).clip(RoundedCornerShape(6.dp)).background(if (done) c.text else Color.Transparent)
                .border(1.5.dp, if (done) c.text else c.textSecondary, RoundedCornerShape(6.dp)),
            contentAlignment = Alignment.Center,
        ) { if (done) Icon("check", c.background, 14.dp) }
    }
}
