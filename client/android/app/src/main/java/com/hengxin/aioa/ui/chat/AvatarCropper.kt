package com.hengxin.aioa.ui.chat

import android.graphics.Bitmap
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

private const val MAX_ZOOM = 8f
private const val QUARTER = 90
private val FRAME_MARGIN = 24.dp
private val MASK = Color.Black.copy(alpha = 0.6f)

/**
 * 头像选择: 选图后先进裁剪页, 拖动 / 双指缩放 / 旋转, 确认后才把裁好的 WebP 交给 [onCropped] 上传。
 * 返回打开相册的函数; 裁剪页由这里自己挂出来。
 */
@Composable
fun rememberAvatarPicker(onError: (String) -> Unit, onCropped: suspend (ByteArray) -> Unit): () -> Unit {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var source by remember { mutableStateOf<Bitmap?>(null) }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) scope.launch { Avatars.decode(context, uri)?.let { source = it } ?: onError("读不了这张图片") }
    }
    source?.let { bmp ->
        AvatarCropper(bmp, { source = null }) { bytes ->
            source = null
            scope.launch { onCropped(bytes) }
        }
    }
    return { pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }
}

/** 全屏裁剪: 圆形取景框, 图片必须盖满取景框; 双击复位。 */
@Composable
private fun AvatarCropper(original: Bitmap, onCancel: () -> Unit, onDone: (ByteArray) -> Unit) {
    val scope = rememberCoroutineScope()
    var bmp by remember(original) { mutableStateOf(original) }
    var zoom by remember(bmp) { mutableFloatStateOf(1f) }
    var offset by remember(bmp) { mutableStateOf(Offset.Zero) }
    var box by remember { mutableStateOf(Size.Zero) }
    var busy by remember { mutableStateOf(false) }
    val image = remember(bmp) { bmp.asImageBitmap() }
    val margin = with(LocalDensity.current) { FRAME_MARGIN.toPx() }
    val frame = (minOf(box.width, box.height) - margin * 2).coerceAtLeast(1f)
    // 基础比例让短边正好盖满取景框, zoom 在此之上放大
    val scale = frame / minOf(bmp.width, bmp.height) * zoom
    fun clamp(o: Offset, s: Float): Offset {
        val mx = ((bmp.width * s - frame) / 2).coerceAtLeast(0f)
        val my = ((bmp.height * s - frame) / 2).coerceAtLeast(0f)
        return Offset(o.x.coerceIn(-mx, mx), o.y.coerceIn(-my, my))
    }
    Dialog(onCancel, DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Column(Modifier.fillMaxSize().background(Color.Black).systemBarsPadding()) {
            Box(
                Modifier.weight(1f).fillMaxWidth()
                    .pointerInput(bmp, frame) {
                        detectTransformGestures { centroid, pan, gestureZoom, _ ->
                            val base = frame / minOf(bmp.width, bmp.height)
                            val next = (zoom * gestureZoom).coerceIn(1f, MAX_ZOOM)
                            // 以手指中心为锚点缩放
                            val anchor = centroid - Offset(size.width / 2f, size.height / 2f)
                            val moved = (offset - anchor) * (next / zoom) + anchor + pan
                            zoom = next
                            offset = clamp(moved, base * next)
                        }
                    }
                    .pointerInput(bmp) { detectTapGestures(onDoubleTap = { zoom = 1f; offset = Offset.Zero }) },
            ) {
                Canvas(Modifier.fillMaxSize()) {
                    box = size
                    val c = center + offset
                    val w = bmp.width * scale
                    val h = bmp.height * scale
                    drawImage(
                        image,
                        dstOffset = IntOffset((c.x - w / 2).roundToInt(), (c.y - h / 2).roundToInt()),
                        dstSize = IntSize(w.roundToInt().coerceAtLeast(1), h.roundToInt().coerceAtLeast(1)),
                    )
                    val r = frame / 2
                    val hole = Path().apply {
                        fillType = PathFillType.EvenOdd
                        addRect(Rect(Offset.Zero, size))
                        addOval(Rect(center, r))
                    }
                    drawPath(hole, MASK)
                    drawCircle(Color.White, r, center, style = Stroke(1.dp.toPx()))
                }
            }
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                TextButton(onCancel) { Text("取消", color = Color.White, fontSize = 16.sp) }
                TextButton({ bmp = Avatars.rotate(bmp, QUARTER) }, enabled = !busy) { Text("旋转", color = Color.White, fontSize = 16.sp) }
                TextButton({
                    busy = true
                    // 取景框在位图坐标里的位置: 图片中心偏移 offset, 比例 scale
                    val side = frame / scale
                    val left = (bmp.width / 2f - offset.x / scale - side / 2).roundToInt()
                    val top = (bmp.height / 2f - offset.y / scale - side / 2).roundToInt()
                    scope.launch { onDone(Avatars.encode(bmp, left, top, side.roundToInt())) }
                }, enabled = !busy && box != Size.Zero) { Text(if (busy) "处理中..." else "完成", color = Color.White, fontSize = 16.sp) }
            }
        }
    }
}
