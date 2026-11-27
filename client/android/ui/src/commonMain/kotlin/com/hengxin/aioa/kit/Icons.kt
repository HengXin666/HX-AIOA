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
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

private const val VIEWPORT = 24f
private const val STROKE = 2f
// 原色图片图标的圆角 (占边长的比例)
private const val CUSTOM_RADIUS = 0.2f

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

/**
 * 自选图标 (#142, 与 protocol isIconRef 一致): 名字是图标库里的, 或上传的图片 "img:<id>" (原色) / "svg:<id>" (单色, 按 tint 着色)。
 * 图片由宿主经 [LocalIconImage] 提供 (组件库不管下载与缓存); 没提供或还没加载好时画 [CUSTOM_FALLBACK]。
 */
object IconRef {
    const val IMG = "img:"
    const val MONO = "svg:"
    const val CUSTOM_FALLBACK = "layout-dashboard"

    fun isCustom(name: String): Boolean = name.startsWith(IMG) || name.startsWith(MONO)

    /** 上传图片的 id; 不是上传的返回 null。 */
    fun imageId(name: String): String? = if (isCustom(name)) name.substringAfter(':') else null
}

/** 宿主提供: 图标引用 → 图片 (加载中或失败为 null)。 */
val LocalIconImage = staticCompositionLocalOf<@Composable (String) -> ImageBitmap?> { { null } }

@Composable
fun Icon(name: String, tint: Color, size: Dp = 18.dp, modifier: Modifier = Modifier) {
    if (IconRef.isCustom(name)) {
        val img = LocalIconImage.current(name)
        if (img != null) {
            Image(
                img,
                contentDescription = null,
                colorFilter = if (name.startsWith(IconRef.MONO)) ColorFilter.tint(tint) else null,
                modifier = modifier.size(size).clip(RoundedCornerShape(size * CUSTOM_RADIUS)),
            )
            return
        }
    }
    val vector = remember(name) { Icons.of(if (IconRef.isCustom(name)) IconRef.CUSTOM_FALLBACK else name) }
    Image(
        painter = rememberVectorPainter(vector),
        contentDescription = name,
        colorFilter = ColorFilter.tint(tint),
        modifier = modifier.size(size),
    )
}
