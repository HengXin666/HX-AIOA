package com.hengxin.aioa.kit

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** 宽度档位, 与 Material 的窗口尺寸类一致: 手机 / 小平板或折叠屏 / 大平板或横屏。 */
enum class WidthClass { Compact, Medium, Expanded }

private val MEDIUM_MIN = 600.dp
private val EXPANDED_MIN = 840.dp

fun widthClassOf(width: Dp): WidthClass = when {
    width < MEDIUM_MIN -> WidthClass.Compact
    width < EXPANDED_MIN -> WidthClass.Medium
    else -> WidthClass.Expanded
}

val LocalWidthClass = staticCompositionLocalOf { WidthClass.Compact }

/** 按可用宽度提供档位, 页面和组件据此切换布局, 不看设备型号。 */
@Composable
fun Adaptive(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    BoxWithConstraints(modifier) {
        CompositionLocalProvider(LocalWidthClass provides widthClassOf(maxWidth)) { content() }
    }
}

/** 自适应网格: 每格不小于 minCell, 列数随宽度变化但不超过 maxCols; span 让一项占多列 (如图表)。 */
@Composable
fun <T> AdaptiveGrid(
    items: List<T>,
    minCell: Dp = if (LocalWidthClass.current == WidthClass.Compact) 150.dp else 210.dp,
    span: (T) -> Int = { 1 },
    maxCols: Int = Int.MAX_VALUE,
    content: @Composable (T) -> Unit,
) {
    val gap = Aioa.metrics.gap
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val cols = ((maxWidth + gap) / (minCell + gap)).toInt().coerceIn(1, maxCols)
        val rows = mutableListOf<MutableList<T>>()
        var used = cols
        for (it in items) {
            val s = span(it).coerceIn(1, cols)
            if (used + s > cols) { rows += mutableListOf<T>(); used = 0 }
            rows.last() += it
            used += s
        }
        Column(verticalArrangement = Arrangement.spacedBy(gap)) {
            rows.forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(gap)) {
                    var filled = 0
                    row.forEach { item ->
                        val s = span(item).coerceIn(1, cols)
                        filled += s
                        Box(Modifier.weight(s.toFloat())) { content(item) }
                    }
                    if (filled < cols) Spacer(Modifier.weight((cols - filled).toFloat()))
                }
            }
        }
    }
}
