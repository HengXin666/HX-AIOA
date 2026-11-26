package com.hengxin.aioa.kit

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

private val DRAWER_MAX = 320.dp
private const val DRAWER_RATIO = 0.84f
private const val SCRIM_ALPHA = 0.45f
// 松手时速度超过这个值 (px/s) 就按方向开合, 否则看过没过一半
private const val FLING_VELOCITY = 800f
private const val HALF = 0.5f
private val DRAWER_SPRING = spring<Float>(dampingRatio = 0.92f, stiffness = 520f)
private val BAR_HEIGHT = 56.dp
private val MENU_WIDTH = 248.dp
private const val MENU_ENTER_MS = 160
private const val MENU_FROM_SCALE = 0.92f

/** 首页侧边栏的开合进度 0..1, 拖动与点按都改它。 */
@Stable
class HomeShellState(initial: Float = 0f) {
    internal val progress = Animatable(initial)
    val fraction: Float get() = progress.value
    val isOpen: Boolean get() = progress.targetValue > HALF
    suspend fun open() = progress.animateTo(1f, DRAWER_SPRING)
    suspend fun close() = progress.animateTo(0f, DRAWER_SPRING)
    suspend fun snapTo(value: Float) = progress.snapTo(value.coerceIn(0f, 1f))
}

@Composable
fun rememberHomeShellState(initial: Float = 0f): HomeShellState = remember { HomeShellState(initial) }

/**
 * ChatGPT 式首页骨架: 左侧栏在内容下方, 打开时把内容整体推向右边并压暗 (不是盖住)。
 * 任意位置横向拖动都能开合, 点被推开的内容收起。
 */
@Composable
fun HomeShell(
    state: HomeShellState,
    sidebar: @Composable () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val c = Aioa.colors
    val scope = rememberCoroutineScope()
    BoxWithConstraints(modifier.fillMaxSize().background(c.sidebar)) {
        val width: Dp = minOf(maxWidth * DRAWER_RATIO, DRAWER_MAX)
        val widthPx = with(LocalDensity.current) { width.toPx() }
        val p = state.fraction
        val drag = rememberDraggableState { delta -> scope.launch { state.snapTo(state.fraction + delta / widthPx) } }
        val dragModifier = Modifier.draggable(
            drag, Orientation.Horizontal,
            onDragStopped = { v ->
                val open = if (kotlin.math.abs(v) > FLING_VELOCITY) v > 0 else state.fraction > HALF
                if (open) state.open() else state.close()
            },
        )
        Box(Modifier.fillMaxSize().then(dragModifier)) {
            // 侧栏比内容慢一点出来, 有层次但不晃
            Box(
                Modifier.width(width).fillMaxHeight()
                    .offset { IntOffset(((p - 1f) * widthPx * 0.3f).roundToInt(), 0) }
                    .graphicsLayer { alpha = 0.4f + 0.6f * p },
            ) { sidebar() }
            Box(
                Modifier.fillMaxSize()
                    .offset { IntOffset((p * widthPx).roundToInt(), 0) }
                    .background(c.background),
            ) {
                content()
                if (p > 0f) {
                    Box(
                        Modifier.fillMaxSize().background(c.scrim.copy(alpha = SCRIM_ALPHA * p))
                            .pointerTap { scope.launch { state.close() } },
                    )
                }
            }
        }
    }
}

/** 顶栏: 左边两道杠开侧栏, 中间是当前空间 (点开切换), 右边圆圈打开菜单。 */
@Composable
fun HomeTopBar(
    title: String,
    titleOpen: Boolean,
    onMenu: () -> Unit,
    onTitle: () -> Unit,
    menuOpen: Boolean,
    onMore: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = Aioa.colors
    val turn by animateFloatAsState(if (titleOpen) 180f else 0f, tween(MENU_ENTER_MS, easing = FastOutSlowInEasing))
    Row(modifier.fillMaxWidth().height(BAR_HEIGHT).padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        BarIcon("menu", onMenu)
        Spacer(Modifier.weight(1f))
        Row(
            Modifier.clip(RoundedCornerShape(50)).background(c.surface).border(1.dp, c.border, RoundedCornerShape(50))
                .pointerTap(onTitle).padding(horizontal = 14.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(title, c.text, 16, weight = FontWeight.SemiBold)
            Icon("chevron-down", c.textSecondary, 16.dp, Modifier.graphicsLayer { rotationZ = turn })
        }
        Spacer(Modifier.weight(1f))
        val ring = if (menuOpen) c.text else c.border
        Box(
            Modifier.size(44.dp).pointerTap(onMore),
            contentAlignment = Alignment.Center,
        ) {
            Box(
                Modifier.size(38.dp).clip(CircleShape).border(1.dp, ring, CircleShape).background(c.surface),
                contentAlignment = Alignment.Center,
            ) { Icon("ellipsis", c.text, 18.dp) }
        }
    }
}

/** 顶栏上浮着的圆形按钮: 实底 + 细描边, 没有整条栏背景 (ChatGPT 做法)。 */
@Composable
private fun BarIcon(name: String, onClick: () -> Unit) {
    val c = Aioa.colors
    Box(Modifier.size(44.dp).pointerTap(onClick), contentAlignment = Alignment.Center) {
        Box(
            Modifier.size(38.dp).clip(CircleShape).background(c.surface).border(1.dp, c.border, CircleShape),
            contentAlignment = Alignment.Center,
        ) { Icon(name, c.text, 19.dp) }
    }
}

/** 菜单里的一项; divider 为 true 时在它上面画分隔线。 */
data class MenuEntry(
    val key: String,
    val title: String,
    val icon: String,
    val hint: String = "",
    val danger: Boolean = false,
    val divider: Boolean = false,
)

/** 右上角菜单: 从圆圈按钮处缩放展开, 深色下是 ChatGPT 那种浮起的灰卡片。 */
@Composable
fun DropMenu(
    visible: Boolean,
    entries: List<MenuEntry>,
    onPick: (MenuEntry) -> Unit,
    onDismiss: () -> Unit,
    alignment: Alignment = Alignment.TopEnd,
    offset: IntOffset = IntOffset(0, 0),
    width: Dp = MENU_WIDTH,
    header: (@Composable () -> Unit)? = null,
) {
    val shown by animateFloatAsState(if (visible) 1f else 0f, tween(MENU_ENTER_MS, easing = FastOutSlowInEasing))
    if (shown == 0f && !visible) return
    val c = Aioa.colors
    val origin = if (alignment == Alignment.TopEnd) TransformOrigin(1f, 0f) else TransformOrigin(0.5f, 0f)
    Popup(alignment = alignment, offset = offset, onDismissRequest = onDismiss, properties = PopupProperties(focusable = true)) {
        Column(
            Modifier.padding(8.dp).width(width)
                .graphicsLayer {
                    alpha = shown
                    val s = MENU_FROM_SCALE + (1f - MENU_FROM_SCALE) * shown
                    scaleX = s; scaleY = s; transformOrigin = origin
                }
                .shadow(16.dp, RoundedCornerShape(16.dp))
                .clip(RoundedCornerShape(16.dp))
                .background(c.popover)
                .border(1.dp, c.border.copy(alpha = 0.5f), RoundedCornerShape(16.dp))
                .padding(vertical = 6.dp),
        ) {
            header?.invoke()
            entries.forEach { e ->
                if (e.divider) Box(Modifier.padding(vertical = 4.dp).fillMaxWidth().height(1.dp).background(c.border.copy(alpha = 0.6f)))
                MenuRow(e) { onPick(e) }
            }
        }
    }
}

@Composable
private fun MenuRow(e: MenuEntry, onClick: () -> Unit) {
    val c = Aioa.colors
    val tint = if (e.danger) c.danger else c.text
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 6.dp).clip(RoundedCornerShape(10.dp)).pointerTap(onClick)
            .padding(horizontal = 10.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(e.icon, tint, 18.dp)
        Text(e.title, tint, 15, Modifier.weight(1f))
        if (e.hint.isNotEmpty()) Text(e.hint, c.textSecondary, 13)
    }
}

/** 置顶空间的横排切换条 (Telegram 文件夹式): 选中项是实底小圆角块, 不用胶囊。 */
@Composable
fun SpaceTabs(spaces: List<HomeSpace>, selected: String, onSelect: (String) -> Unit, modifier: Modifier = Modifier) {
    val c = Aioa.colors
    Row(
        modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        spaces.forEach { s ->
            val on = s.id == selected
            val bg by animateFloatAsState(if (on) 1f else 0f, tween(MENU_ENTER_MS))
            Row(
                Modifier.clip(RoundedCornerShape(10.dp)).background(c.surface.copy(alpha = bg))
                    .pointerTap { onSelect(s.id) }.padding(horizontal = 12.dp, vertical = 7.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(s.title, if (on) c.text else c.textSecondary, 14, weight = if (on) FontWeight.Medium else FontWeight.Normal)
                if (s.badge > 0) Text(s.badge.toString(), c.textSecondary, 12)
            }
        }
    }
}
