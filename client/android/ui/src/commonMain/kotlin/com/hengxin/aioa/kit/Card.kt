package com.hengxin.aioa.kit

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.composed
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private const val PRESSED_SCALE = 0.97f

/** 组件的四种非正常状态, 加上正常的 Ready。 */
sealed interface CardState {
    data object Ready : CardState
    data object Loading : CardState
    data object Empty : CardState
    data class Error(val reason: String) : CardState
    data class Stale(val lastUpdate: String) : CardState
}

/** 按压回弹: 只动 graphicsLayer 的缩放, 不触发重新布局。 */
fun Modifier.pressable(onClick: (() -> Unit)? = null): Modifier = this.then(
    Modifier.composed {
        var pressed by remember { mutableStateOf(false) }
        val scale by animateFloatAsState(
            if (pressed) PRESSED_SCALE else 1f,
            spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMedium),
        )
        graphicsLayer { scaleX = scale; scaleY = scale }
            .pointerInput(onClick) {
                detectTapGestures(
                    onPress = { pressed = true; tryAwaitRelease(); pressed = false },
                    onTap = { onClick?.invoke() },
                )
            }
    },
)

/** 卡片外壳: 极简风格下用极淡底色区分, 不用阴影。 */
@Composable
fun Card(modifier: Modifier = Modifier, onClick: (() -> Unit)? = null, content: @Composable ColumnScope.() -> Unit) {
    val c = Aioa.colors
    val m = Aioa.metrics
    val shape = RoundedCornerShape(m.radius)
    Column(
        modifier.fillMaxWidth().pressable(onClick).clip(shape).background(c.surface)
            .border(1.dp, c.border.copy(alpha = if (Aioa.tokens.dark) 0f else 0.6f), shape)
            .padding(m.padding),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        content = content,
    )
}

/** 卡片头: 图标 + 标题 + 右侧来源小标记。 */
@Composable
fun CardHeader(icon: String, title: String, source: String? = null) {
    val c = Aioa.colors
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, c.textSecondary, 16.dp)
        Spacer(Modifier.width(6.dp))
        Text(title, c.textSecondary, 13, Modifier.weight(1f))
        source?.let { Text(it, c.textSecondary.copy(alpha = 0.7f), 11) }
    }
}

/** 数值卡: 当前值 + 单位 + 变化, 右侧迷你折线; 数字变化时上下滚动。 */
@Composable
fun StatCard(
    icon: String,
    title: String,
    value: Float,
    unit: String,
    state: CardState = CardState.Ready,
    delta: String? = null,
    trend: List<Float> = emptyList(),
    source: String? = null,
    onClick: (() -> Unit)? = null,
) {
    val c = Aioa.colors
    Card(onClick = onClick) {
        CardHeader(icon, title, source)
        when (state) {
            CardState.Loading -> Skeleton()
            CardState.Empty -> Text("暂无数据", c.textSecondary, 14)
            is CardState.Error -> Row(verticalAlignment = Alignment.CenterVertically) {
                Icon("alert-triangle", c.danger, 16.dp)
                Spacer(Modifier.width(6.dp))
                Text(state.reason, c.danger, 14)
            }
            else -> Row(verticalAlignment = Alignment.Bottom) {
                val stale = state is CardState.Stale
                Row(Modifier.alpha(if (stale) 0.5f else 1f), verticalAlignment = Alignment.Bottom) {
                    AnimatedContent(
                        targetState = fmt(value),
                        transitionSpec = {
                            (slideInVertically { it / 2 } + fadeIn(tween(200))) togetherWith
                                (slideOutVertically { -it / 2 } + fadeOut(tween(150)))
                        },
                    ) { Text(it, c.text, 30, weight = FontWeight.SemiBold) }
                    Spacer(Modifier.width(3.dp))
                    Text(unit, c.textSecondary, 14, Modifier.padding(bottom = 5.dp))
                }
                Spacer(Modifier.width(8.dp))
                if (trend.size > 1) {
                    Box(Modifier.weight(1f), contentAlignment = Alignment.BottomEnd) {
                        Sparkline(trend, Modifier.widthIn(max = 72.dp).fillMaxWidth().height(28.dp))
                    }
                } else Spacer(Modifier.weight(1f))
            }
        }
        val foot = when {
            state is CardState.Stale -> "已过期 · 最后更新 ${state.lastUpdate}" to c.warning
            delta != null && state == CardState.Ready -> delta to c.textSecondary
            else -> null
        }
        foot?.let { (t, color) -> Text(t, color, 12) }
    }
}

/** 加载骨架: 透明度呼吸, 不改尺寸。 */
@Composable
fun Skeleton() {
    val c = Aioa.colors
    val pulse = androidx.compose.animation.core.rememberInfiniteTransition()
    val a by pulse.animateFloat(
        0.4f, 1f,
        androidx.compose.animation.core.infiniteRepeatable(tween(700), androidx.compose.animation.core.RepeatMode.Reverse),
    )
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.width(96.dp).height(28.dp).alpha(a).clip(RoundedCornerShape(6.dp)).background(c.surfaceAlt))
        Box(Modifier.width(140.dp).height(12.dp).alpha(a).clip(RoundedCornerShape(6.dp)).background(c.surfaceAlt))
    }
}

/** 状态小圆点。 */
@Composable
fun Dot(color: Color) {
    Box(Modifier.size(8.dp).clip(CircleShape).background(color))
}

/** 统一文字入口, 数字用等宽数字。 */
@Composable
fun Text(
    text: String,
    color: Color,
    sizeSp: Int,
    modifier: Modifier = Modifier,
    weight: FontWeight = FontWeight.Normal,
) {
    BasicText(
        text,
        modifier,
        style = TextStyle(color = color, fontSize = sizeSp.sp, fontWeight = weight, fontFeatureSettings = "tnum"),
        overflow = TextOverflow.Ellipsis,
        maxLines = 1,
    )
}
