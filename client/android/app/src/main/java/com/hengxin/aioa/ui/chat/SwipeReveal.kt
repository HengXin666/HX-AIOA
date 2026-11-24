package com.hengxin.aioa.ui.chat

import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.kit.Icon
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/** 左滑露出的一个按钮。 */
class RevealAction(val icon: String, val label: String, val color: Color, val run: () -> Unit)

/** 右滑到阈值松手就执行的快捷操作 (应当可撤销, 如切换已读)。 */
class SwipeQuick(val icon: String, val color: Color, val run: () -> Unit)

private val ACTION_WIDTH = 76.dp
private const val QUICK_RATIO = 0.25f
private const val OVERSHOOT = 1.15f

/**
 * 列表行的滑动操作: 左滑停在按钮处, 点按钮才执行 (不会滑到底就删);
 * 右滑超过阈值松手执行 quick, 然后弹回。open 由外部持有, 保证同一时间只有一行展开。
 */
@Composable
fun SwipeReveal(open: Boolean, onOpen: (Boolean) -> Unit, actions: List<RevealAction>, quick: SwipeQuick?, content: @Composable () -> Unit) {
    val density = LocalDensity.current
    val revealW: Dp = ACTION_WIDTH * actions.size
    val reveal = with(density) { revealW.toPx() }
    val quickMax = with(density) { (revealW * 1.5f).toPx() }
    val x = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(open) { x.animateTo(if (open) -reveal else 0f) }
    Box {
        Box(Modifier.matchParentSize()) {
            if (quick != null && x.value > 0f) {
                Box(Modifier.fillMaxSize().background(quick.color).padding(start = 24.dp), contentAlignment = Alignment.CenterStart) { Icon(quick.icon, Color.White, 22.dp) }
            }
            if (x.value < 0f) {
                Row(Modifier.fillMaxHeight().align(Alignment.CenterEnd)) {
                    actions.forEach { a ->
                        Column(
                            Modifier.fillMaxHeight().width(ACTION_WIDTH).background(a.color).clickable { onOpen(false); a.run() },
                            verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Icon(a.icon, Color.White, 20.dp)
                            Text(a.label, color = Color.White, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
                        }
                    }
                }
            }
        }
        Box(
            Modifier.offset { IntOffset(x.value.roundToInt(), 0) }.pointerInput(actions.size, quick != null) {
                detectHorizontalDragGestures(
                    onDragEnd = {
                        val v = x.value
                        when {
                            v < -reveal / 2 -> { onOpen(true); scope.launch { x.animateTo(-reveal) } }
                            quick != null && v > size.width * QUICK_RATIO -> { quick.run(); onOpen(false); scope.launch { x.animateTo(0f) } }
                            else -> { onOpen(false); scope.launch { x.animateTo(0f) } }
                        }
                    },
                    onDragCancel = { scope.launch { x.animateTo(if (open) -reveal else 0f) } },
                ) { change, d ->
                    change.consume()
                    val max = if (quick != null) quickMax else 0f
                    scope.launch { x.snapTo((x.value + d).coerceIn(-reveal * OVERSHOOT, max)) }
                }
            },
        ) { content() }
    }
}
