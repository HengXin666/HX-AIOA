package com.hengxin.aioa.kit

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

private const val DISABLED_ALPHA = 0.5f

private class ButtonLook(val bg: Color, val fg: Color, val border: Color?)
private class ButtonBox(val height: Dp, val padH: Dp, val text: Int, val icon: Dp, val square: Boolean)

/**
 * 与 HX-UI Button 同名同变体 (variant / size 来自生成的 HxButtonVariant / HxButtonSize)。
 * 两个 when 必须穷尽: HX-UI 加了变体, 这里编译不过, 提醒补上。
 */
@Composable
fun HxButton(
    text: String = "",
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    variant: HxButtonVariant = HxButtonVariant.Default,
    size: HxButtonSize = HxButtonSize.Default,
    icon: String? = null,
    enabled: Boolean = true,
) {
    val c = Aioa.colors
    val look = when (variant) {
        HxButtonVariant.Default -> ButtonLook(c.accent, c.onAccent, null)
        HxButtonVariant.Destructive -> ButtonLook(c.danger, Color.White, null)
        HxButtonVariant.Outline -> ButtonLook(c.background, c.text, c.border)
        HxButtonVariant.Secondary -> ButtonLook(c.surface, c.text, null)
        HxButtonVariant.Ghost -> ButtonLook(Color.Transparent, c.text, null)
        HxButtonVariant.Link -> ButtonLook(Color.Transparent, c.text, null)
        // 网页上是品牌色加扫光; 手机端不做扫光, 只留实底
        HxButtonVariant.Shimmer -> ButtonLook(c.accent, c.onAccent, null)
    }
    val box = when (size) {
        HxButtonSize.Default -> ButtonBox(36.dp, 16.dp, 14, 16.dp, false)
        HxButtonSize.Xs -> ButtonBox(24.dp, 8.dp, 12, 12.dp, false)
        HxButtonSize.Sm -> ButtonBox(32.dp, 12.dp, 14, 16.dp, false)
        HxButtonSize.Lg -> ButtonBox(40.dp, 24.dp, 15, 18.dp, false)
        HxButtonSize.Icon -> ButtonBox(36.dp, 0.dp, 14, 16.dp, true)
        HxButtonSize.IconXs -> ButtonBox(24.dp, 0.dp, 12, 12.dp, true)
        HxButtonSize.IconSm -> ButtonBox(32.dp, 0.dp, 14, 16.dp, true)
        HxButtonSize.IconLg -> ButtonBox(40.dp, 0.dp, 15, 18.dp, true)
    }
    val shape = RoundedCornerShape(HxUi.Radius.md)
    var m = modifier.alpha(if (enabled) 1f else DISABLED_ALPHA).pressable(if (enabled) onClick else null).clip(shape).background(look.bg)
    look.border?.let { m = m.border(1.dp, it, shape) }
    m = if (box.square) m.size(box.height) else m.height(box.height).padding(horizontal = box.padH)
    Box(m, contentAlignment = Alignment.Center) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            icon?.let { Icon(it, look.fg, box.icon) }
            if (text.isNotEmpty() && !box.square) Text(text, look.fg, box.text, weight = FontWeight.Medium)
        }
    }
}
