package com.hengxin.aioa.kit

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

// 树图: 节点 + 画出来的边 (父右缘到子左缘的曲线), 从左往右展开; 手机上竖向是兄弟, 横向是层级, 可拖动缩放

/** 树的一个节点; collapsed 为 true 时不画子节点 (节点自己显示 "+n")。 */
data class TreeNode<T>(val key: String, val value: T, val children: List<TreeNode<T>> = emptyList(), val collapsed: Boolean = false)

/** 布局结果: 左上角坐标 (dp), 层级, 父节点。 */
data class TreeSpot<T>(val node: TreeNode<T>, val x: Float, val y: Float, val depth: Int, val parent: TreeNode<T>?)

private const val MIN_SCALE = 0.4f
private const val MAX_SCALE = 2.5f
private const val DEPTH_MS = 160

/** 简单的整齐树布局: 叶子依次往下排, 父节点竖向居中于第一个与最后一个子节点。 */
fun <T> layoutTree(roots: List<TreeNode<T>>, nodeH: Dp, colW: Dp, gapY: Dp): List<TreeSpot<T>> {
    val out = ArrayList<TreeSpot<T>>()
    var cursor = 0f
    fun place(n: TreeNode<T>, depth: Int, parent: TreeNode<T>?): Float {
        val idx = out.size
        out.add(TreeSpot(n, depth * colW.value, 0f, depth, parent))
        val kids = if (n.collapsed) emptyList() else n.children
        val y = if (kids.isEmpty()) {
            cursor.also { cursor += nodeH.value + gapY.value }
        } else {
            val ys = kids.map { place(it, depth + 1, n) }
            (ys.first() + ys.last()) / 2f
        }
        out[idx] = out[idx].copy(y = y)
        return y
    }
    roots.forEach { place(it, 0, null); cursor += gapY.value }
    return out
}

/**
 * 画一棵 (或几棵) 树。edge 决定每条边的颜色 (按子节点), node 画节点本身。
 * 边按层级依次描出来, 节点跟着淡入; 双指缩放, 单指拖动。
 */
@Composable
fun <T> TreeGraph(
    roots: List<TreeNode<T>>,
    modifier: Modifier = Modifier,
    nodeW: Dp = 188.dp,
    nodeH: Dp = 68.dp,
    gapX: Dp = 44.dp,
    gapY: Dp = 14.dp,
    start: Offset = Offset.Zero,
    scale: Float = 1f,
    edge: (T) -> Color,
    node: @Composable (TreeSpot<T>) -> Unit,
) {
    val spots = remember(roots) { layoutTree(roots, nodeH, nodeW + gapX, gapY) }
    val depth = (spots.maxOfOrNull { it.depth } ?: 0) + 1
    val p = rememberReveal(0, DEPTH_MS * depth + 400)
    var zoom by remember { mutableStateOf(scale) }
    var pan by remember { mutableStateOf(start) }
    val w = (spots.maxOfOrNull { it.x } ?: 0f) + nodeW.value
    val h = (spots.maxOfOrNull { it.y } ?: 0f) + nodeH.value
    Box(
        modifier.clipToBounds().pointerInput(Unit) {
            detectTransformGestures { _, move, gain, _ ->
                zoom = (zoom * gain).coerceIn(MIN_SCALE, MAX_SCALE)
                pan += move
            }
        },
    ) {
        Box(
            Modifier.size(w.dp, h.dp).graphicsLayer {
                scaleX = zoom; scaleY = zoom; translationX = pan.x; translationY = pan.y
                transformOrigin = TransformOrigin(0f, 0f)
            },
        ) {
            Canvas(Modifier.fillMaxSize()) {
                spots.forEach { s ->
                    val parent = s.parent ?: return@forEach
                    val ps = spots.first { it.node === parent }
                    // 这一层的边在入场进度走到它时才描出来
                    val k = ((p * depth) - (s.depth - 1)).coerceIn(0f, 1f)
                    if (k <= 0f) return@forEach
                    val a = Offset((ps.x + nodeW.value).dp.toPx(), (ps.y + nodeH.value / 2).dp.toPx())
                    val b = Offset(s.x.dp.toPx(), (s.y + nodeH.value / 2).dp.toPx())
                    val mid = (a.x + b.x) / 2
                    val path = Path().apply { moveTo(a.x, a.y); cubicTo(mid, a.y, mid, b.y, b.x, b.y) }
                    val tint = edge(s.node.value)
                    drawPath(path, tint.copy(alpha = tint.alpha * k), style = Stroke(1.6.dp.toPx(), cap = StrokeCap.Round))
                    drawCircle(tint.copy(alpha = tint.alpha * k), 2.5.dp.toPx(), a)
                }
            }
            spots.forEach { s ->
                val k = ((p * depth) - s.depth + 0.4f).coerceIn(0f, 1f)
                Box(
                    Modifier.offset(s.x.dp, s.y.dp).size(nodeW, nodeH).graphicsLayer { alpha = k; translationX = (1f - k) * -12.dp.toPx() },
                ) { node(s) }
            }
        }
    }
}
