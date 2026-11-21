package com.hengxin.aioa.kit

import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.foundation.Image
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

private const val VIEWPORT = 24f
private const val STROKE = 2f

/** schema 里只写图标名, 这里统一转成线性图标; 不认识的名字退回 activity。 */
object Icons {
    private val cache = HashMap<String, ImageVector>()

    fun of(name: String): ImageVector = cache.getOrPut(name) { build(name) }

    val names: Set<String> get() = LucidePaths.all.keys

    private fun build(name: String): ImageVector {
        val paths = LucidePaths.all[name] ?: LucidePaths.all.getValue(FALLBACK)
        val b = ImageVector.Builder(name, 24.dp, 24.dp, VIEWPORT, VIEWPORT)
        for (d in paths) {
            b.addPath(
                pathData = addPathNodes(d),
                fill = null,
                stroke = SolidColor(Color.Black),
                strokeLineWidth = STROKE,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
            )
        }
        return b.build()
    }

    private const val FALLBACK = "activity"
}

@Composable
fun Icon(name: String, tint: Color, size: Dp = 18.dp, modifier: Modifier = Modifier) {
    val vector = remember(name) { Icons.of(name) }
    Image(
        painter = rememberVectorPainter(vector),
        contentDescription = name,
        colorFilter = ColorFilter.tint(tint),
        modifier = modifier.size(size),
    )
}
