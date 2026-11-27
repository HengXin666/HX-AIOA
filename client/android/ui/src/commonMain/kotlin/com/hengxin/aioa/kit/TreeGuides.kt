package com.hengxin.aioa.kit

import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

// 树形列表 (带缩进的表格) 的连线: 每层一根竖线, 子项用圆角拐角连到自己的勾选框, 展开的父项往下引一根线

/** 树形列表里一行的位置: 从第 1 层到自己, 每一层 "是不是兄弟里的最后一个"; 根为空表。 */
typealias TreePath = List<Boolean>

/**
 * 在行背后画连线。lasts 见 [TreePath]; open 为这一行是展开的父项。
 * start 为第 0 层勾选框的左边距, indent 每层缩进, marker 勾选框边长, top 勾选框上边距 (都要和行布局一致)。
 */
fun Modifier.treeGuides(
    lasts: TreePath,
    open: Boolean,
    color: Color,
    start: Dp = 12.dp,
    indent: Dp = 22.dp,
    marker: Dp = 20.dp,
    top: Dp = 9.dp,
): Modifier = drawBehind {
    val d = lasts.size
    val w = 1.dp.toPx()
    fun cx(level: Int) = (start + indent * level + marker / 2).toPx()
    val mid = (top + marker / 2).toPx()
    for (k in 0 until d - 1) if (!lasts[k]) drawLine(color, Offset(cx(k), 0f), Offset(cx(k), size.height), w)
    if (d > 0) {
        val x = cx(d - 1)
        val r = 6.dp.toPx()
        val end = (start + indent * d).toPx() - 3.dp.toPx()
        val elbow = Path().apply {
            moveTo(x, 0f)
            lineTo(x, mid - r)
            quadraticTo(x, mid, x + r, mid)
            lineTo(end, mid)
        }
        drawPath(elbow, color, style = Stroke(w))
        if (!lasts[d - 1]) drawLine(color, Offset(x, mid), Offset(x, size.height), w)
    }
    if (open) drawLine(color, Offset(cx(d), (top + marker).toPx() + 2.dp.toPx()), Offset(cx(d), size.height), w)
}
