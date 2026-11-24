package com.hengxin.aioa.ui.chat

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private const val SEND_IN_MS = 240
private const val SEND_RISE_PX = 48f
private const val SEND_SCALE_FROM = 0.92f

/** 刚发出的气泡: 从输入框方向上滑, 淡入, 轻微放大; 只在第一次出现时播一次。 */
fun Modifier.sendIn(): Modifier = composed {
    val t = remember { Animatable(0f) }
    LaunchedEffect(Unit) { t.animateTo(1f, tween(SEND_IN_MS, easing = FastOutSlowInEasing)) }
    graphicsLayer {
        val v = t.value
        alpha = v
        translationY = (1f - v) * SEND_RISE_PX
        val s = SEND_SCALE_FROM + (1f - SEND_SCALE_FROM) * v
        scaleX = s
        scaleY = s
        transformOrigin = androidx.compose.ui.graphics.TransformOrigin(1f, 1f)
    }
}

/** 往上翻着看时来了新消息: 右下角一个小条, 点了回到底部。 */
@Composable
fun NewMessagesChip(count: Int, modifier: Modifier, onClick: () -> Unit) {
    val c = MaterialTheme.colorScheme
    Text(
        "↓ $count 条新消息",
        modifier.shadow(3.dp, RoundedCornerShape(16.dp)).background(c.primary, RoundedCornerShape(16.dp)).clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 6.dp),
        color = c.onPrimary,
        fontSize = 13.sp,
    )
}
