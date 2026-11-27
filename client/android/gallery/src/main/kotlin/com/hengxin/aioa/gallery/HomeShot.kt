package com.hengxin.aioa.gallery

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.ImageComposeScene
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import com.hengxin.aioa.kit.AioaTheme
import com.hengxin.aioa.kit.Appearance
import org.jetbrains.skia.EncodedImageFormat
import java.io.File

private const val SCALE = 3f
private const val W = 390
private const val H = 844
private const val FULL_H = 1880
private const val SETTLE_MS = 1800L
private const val FRAME_MS = 50L

/** 新总览各状态截图 (明暗各一套) 和侧栏拉开的逐帧图。参数为输出目录。 */
fun main(args: Array<String>) {
    val out = File(args.firstOrNull() ?: "build/home-shots").apply { mkdirs() }
    val states: List<Pair<String, @Composable () -> Unit>> = listOf(
        "1-overview" to { HomeDemo() },
        "2-sidebar" to { HomeDemo(drawer = 1f) },
        "3-menu" to { HomeDemo(menu = true) },
        "4-switcher" to { HomeDemo(switcher = true) },
        "5-chat" to { HomeDemo(start = "chat") },
        "6-dev" to { HomeDemo(start = "dev") },
        "7-server" to { HomeDemo(start = "server") },
        "8-todo" to { HomeDemo(start = "todo") },
    )
    for (dark in listOf(true, false)) {
        val mode = if (dark) "dark" else "light"
        states.forEach { (name, content) -> shot(File(out, "$name-$mode.png"), dark, content = content) }
        // 总览整页 (不滚动, 一次看全)
        shot(File(out, "0-overview-full-$mode.png"), dark, FULL_H) { HomeDemo() }
        listOf(0f, 0.2f, 0.4f, 0.6f, 0.8f, 1f).forEachIndexed { i, f ->
            shot(File(out, "drawer-$mode-$i.png"), dark) { HomeDemo(drawer = f) }
        }
    }
    // 入场动效逐帧 (错开淡入, 数字滚动, 曲线描出), 拼 GIF 用
    frames(File(out, "enter"), true) { HomeDemo() }
    println("截图输出到 ${out.path}")
}

private fun shot(file: File, dark: Boolean, h: Int = H, content: @Composable () -> Unit) {
    val scene = ImageComposeScene((W * SCALE).toInt(), (h * SCALE).toInt(), Density(SCALE)) {
        CompositionLocalProvider(LocalDensity provides Density(SCALE)) {
            AioaTheme(Appearance(dark = dark)) { content() }
        }
    }
    var t = 0L
    while (t < SETTLE_MS) { scene.render(t * 1_000_000); t += FRAME_MS }
    val image = scene.render(SETTLE_MS * 1_000_000)
    file.writeBytes(image.encodeToData(EncodedImageFormat.PNG)!!.bytes)
    scene.close()
}

private fun frames(dir: File, dark: Boolean, content: @Composable () -> Unit) {
    dir.mkdirs()
    val scene = ImageComposeScene((W * SCALE).toInt(), (H * SCALE).toInt(), Density(SCALE)) {
        CompositionLocalProvider(LocalDensity provides Density(SCALE)) {
            AioaTheme(Appearance(dark = dark)) { content() }
        }
    }
    var i = 0
    var t = 0L
    while (t <= SETTLE_MS) {
        val image = scene.render(t * 1_000_000)
        File(dir, "f%03d.png".format(i++)).writeBytes(image.encodeToData(EncodedImageFormat.PNG)!!.bytes)
        t += FRAME_MS
    }
    scene.close()
}
