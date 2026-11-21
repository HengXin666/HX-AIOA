package com.hengxin.aioa.gallery

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.ImageComposeScene
import androidx.compose.ui.unit.Density
import androidx.compose.ui.platform.LocalDensity
import com.hengxin.aioa.kit.AioaTheme
import com.hengxin.aioa.kit.Appearance
import org.jetbrains.skia.EncodedImageFormat
import java.io.File

private const val SHOT_SCALE = 2f
private const val SETTLE_MS = 1000L
private const val FRAME_MS = 100L

/** 无界面截图: 每个页面 x 设备 x 明暗出一张 PNG, 给 CI 和自查用。参数为输出目录。 */
fun main(args: Array<String>) {
    val out = File(args.firstOrNull() ?: "build/screenshots").apply { mkdirs() }
    for (page in Page.entries) for (device in Device.entries) for (dark in listOf(false, true)) {
        val w = (device.size.width.value * SHOT_SCALE).toInt()
        val h = (device.size.height.value * SHOT_SCALE).toInt()
        val scene = ImageComposeScene(w, h, Density(SHOT_SCALE)) {
            CompositionLocalProvider(LocalDensity provides Density(SHOT_SCALE)) {
                AioaTheme(Appearance(dark = dark)) { Screen { page.content() } }
            }
        }
        var t = 0L
        while (t < SETTLE_MS) { scene.render(t * 1_000_000); t += FRAME_MS }
        val image = scene.render(SETTLE_MS * 1_000_000)
        val name = "${page.name.lowercase()}-${device.name.lowercase()}-${if (dark) "dark" else "light"}.png"
        File(out, name).writeBytes(image.encodeToData(EncodedImageFormat.PNG)!!.bytes)
        scene.close()
    }
    println("截图输出到 ${out.path}")
}
