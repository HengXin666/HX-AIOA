package com.hengxin.aioa.kit

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.PI
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

// 成就感图表 (#140): 放射柱 (一圈光线), 里程碑环; 只用 HX-UI 图表色

private const val INNER = 0.42f
private const val RAY_STAGGER = 0.5f
private const val FULL_DEG = 360f
private const val TOP_DEG = -90f

/** 里程碑台阶: 到了一个就亮下一个。 */
val MILESTONES = listOf(10, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000, 50_000, 100_000, 200_000, 500_000, 1_000_000)

/** n 之上的下一个里程碑, 与已经达成的上一个 (没有时为 0)。 */
fun milestoneOf(n: Int): Pair<Int, Int> {
    val next = MILESTONES.firstOrNull { it > n } ?: (n / MILESTONES.last() + 1) * MILESTONES.last()
    val prev = MILESTONES.lastOrNull { it <= n } ?: 0
    return prev to next
}

/**
 * 放射柱: values 一项一根光线, 从 12 点顺时针排开, 长度按平方根 (小数也看得见);
 * 出现时一根根长出来, highlight 那根末端有呼吸光点。点一下回调 onPick(序号)。
 */
@Composable
fun RadialBars(
    values: List<Float>,
    from: Color,
    to: Color,
    modifier: Modifier = Modifier,
    highlight: Int = values.lastIndex,
    delayMs: Int = 0,
    onPick: ((Int) -> Unit)? = null,
    center: @Composable BoxScope.() -> Unit = {},
) {
    if (values.isEmpty()) return
    val p = rememberReveal(delayMs, 1300)
    val pulse by rememberInfiniteTransition().animateFloat(0f, 1f, infiniteRepeatable(tween(1600, easing = LinearEasing)))
    val track = Aioa.colors.surfaceAlt
    val n = values.size
    val tap = if (onPick == null) Modifier else Modifier.pointerInput(n) {
        detectTapGestures { o ->
            val dx = o.x - size.width / 2f
            val dy = o.y - size.height / 2f
            var deg = (atan2(dy, dx) * 180 / PI).toFloat() - TOP_DEG
            if (deg < 0) deg += FULL_DEG
            onPick(((deg + FULL_DEG / n / 2) / (FULL_DEG / n)).toInt() % n)
        }
    }
    Box(modifier.then(tap), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val r = size.minDimension / 2
            val inner = r * INNER
            val span = r - inner - 6.dp.toPx()
            val mx = values.max().takeIf { it > 0f } ?: 1f
            val step = FULL_DEG / n
            val w = (2 * PI * inner / n * 0.55f).toFloat().coerceIn(2.dp.toPx(), 10.dp.toPx())
            val o = Offset(size.width / 2, size.height / 2)
            // 内圈细轨 + 外圈刻度点, 空的时候也像个表盘
            drawCircle(track, inner - w, o, style = Stroke(1.dp.toPx()))
            values.forEachIndexed { i, v ->
                val local = ((p * (1 + RAY_STAGGER) - i.toFloat() / n * RAY_STAGGER)).coerceIn(0f, 1f)
                val len = if (v <= 0f) 0f else (sqrt(v / mx) * span).coerceAtLeast(w) * local
                val a = ((TOP_DEG + i * step) * PI / 180).toFloat()
                val dir = Offset(cos(a), sin(a))
                val s = o + dir * inner
                val e = o + dir * (inner + len)
                drawCircle(track, w / 3, o + dir * (inner + span), alpha = 0.8f)
                if (len <= 0f) return@forEachIndexed
                val k = (v / mx).coerceIn(0f, 1f)
                drawLine(Brush.linearGradient(listOf(from, lerpColor(from, to, k)), s, e), s, e, w, StrokeCap.Round)
                if (i == highlight) {
                    drawCircle(to.copy(alpha = 0.35f * (1 - pulse)), w * (1.2f + 1.6f * pulse), e)
                    drawCircle(to, w * 0.75f, e)
                }
            }
        }
        center()
    }
}

/** 里程碑环: 从上一个里程碑走到下一个的进度, 渐变弧 + 弧头光点, 中间放内容。 */
@Composable
fun MilestoneRing(
    fraction: Float,
    from: Color,
    to: Color,
    modifier: Modifier = Modifier,
    stroke: Dp = 10.dp,
    delayMs: Int = 0,
    content: @Composable BoxScope.() -> Unit = {},
) {
    val p = rememberReveal(delayMs, 1400)
    val glow by rememberInfiniteTransition().animateFloat(0.4f, 1f, infiniteRepeatable(tween(1800, easing = LinearEasing), androidx.compose.animation.core.RepeatMode.Reverse))
    val track = Aioa.colors.surfaceAlt
    Box(modifier, contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val s = stroke.toPx()
            val tl = Offset(s / 2, s / 2)
            val sz = Size(size.width - s, size.height - s)
            val sweep = FULL_DEG * fraction.coerceIn(0f, 1f) * p
            drawArc(track, 0f, FULL_DEG, false, tl, sz, style = Stroke(s))
            rotate(TOP_DEG) { drawArc(Brush.sweepGradient(listOf(from, to, from)), 0f, sweep, false, tl, sz, style = Stroke(s, cap = StrokeCap.Round)) }
            if (sweep > 0f) {
                val a = ((TOP_DEG + sweep) * PI / 180).toFloat()
                val rr = sz.width / 2
                val head = Offset(size.width / 2 + cos(a) * rr, size.height / 2 + sin(a) * rr)
                drawCircle(to.copy(alpha = 0.3f * glow), s * 1.1f, head)
                drawCircle(Color.White.copy(alpha = 0.9f), s * 0.22f, head)
            }
        }
        content()
    }
}

private fun lerpColor(a: Color, b: Color, t: Float) = Color(
    a.red + (b.red - a.red) * t,
    a.green + (b.green - a.green) * t,
    a.blue + (b.blue - a.blue) * t,
    a.alpha + (b.alpha - a.alpha) * t,
)
