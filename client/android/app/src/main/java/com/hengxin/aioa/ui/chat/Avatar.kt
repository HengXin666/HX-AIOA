package com.hengxin.aioa.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.sp

// 名字散列到固定配色, 同一个群或来源在哪都是同一种颜色
private val PALETTE = listOf(
    Color(0xFFE17076), Color(0xFFFAA774), Color(0xFFA695E7), Color(0xFF7BC862),
    Color(0xFF6EC9CB), Color(0xFF65AADD), Color(0xFFEE7AAE), Color(0xFFD4A04C),
)
private const val FONT_RATIO = 0.42f

fun colorOf(key: String): Color = PALETTE[Math.floorMod(key.hashCode(), PALETTE.size)]

fun initialOf(key: String): String {
    val name = key.substringAfterLast('/').trim()
    val first = name.firstOrNull { it.isLetterOrDigit() } ?: return "#"
    return first.uppercase()
}

/** 文字头像; 以后有图片头像时由调用方换成图片。 */
@Composable
fun LetterAvatar(key: String, size: Dp, modifier: Modifier = Modifier) {
    Box(modifier.size(size).background(colorOf(key), CircleShape), contentAlignment = Alignment.Center) {
        Text(initialOf(key), color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = (size.value * FONT_RATIO).sp)
    }
}
