package com.hengxin.aioa.ui.chat

import android.graphics.BitmapFactory
import android.widget.Toast
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.proto.FileRef
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

private val SHAPE = RoundedCornerShape(10.dp)
// 小图片自动下载显示; 大图和其他文件点了才下, 省流量也省额度
private const val AUTO_IMAGE_BYTES = 2L * 1024 * 1024
private const val THUMB_PX = 720
private const val PCT_SCALE = 100

/** 消息里的附件: 图片显示缩略图, 其他文件显示名字和大小; 点开下载 (只下一次) 并用系统应用打开。 */
@Composable
fun FileCard(f: FileRef, fg: Color, modifier: Modifier = Modifier) {
    val context = LocalContext.current.applicationContext
    val scope = rememberCoroutineScope()
    var local by remember(f.id) { mutableStateOf(FileTransfer.cached(context, f)) }
    var progress by remember(f.id) { mutableStateOf<Float?>(null) }
    val fetch: (Boolean) -> Unit = { openAfter ->
        if (progress == null) {
            progress = 0f
            scope.launch {
                FileTransfer.download(context, f) { p -> scope.launch { progress = p } }
                    .onSuccess { local = it; if (openAfter) FileTransfer.open(context, it, f.mime) }
                    .onFailure { Toast.makeText(context, it.message ?: "下载失败", Toast.LENGTH_SHORT).show() }
                progress = null
            }
        }
    }
    val click = { local?.let { FileTransfer.open(context, it, f.mime) } ?: fetch(true); Unit }
    if (f.image) {
        LaunchedEffect(f.id) { if (local == null && f.size <= AUTO_IMAGE_BYTES) fetch(false) }
        val bmp = thumb(local)
        if (bmp != null) {
            Image(bmp, f.name, modifier.widthIn(max = 260.dp).heightIn(max = 320.dp).clip(SHAPE).clickable(onClick = click), contentScale = ContentScale.Fit)
            return
        }
    }
    Row(modifier.background(fg.copy(alpha = 0.08f), SHAPE).clickable(onClick = click).padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(36.dp).background(fg.copy(alpha = 0.12f), SHAPE), contentAlignment = Alignment.Center) {
            Text(extOf(f.name), fontSize = 10.sp, fontWeight = FontWeight.Bold, color = fg)
        }
        Column(Modifier.padding(start = 10.dp).widthIn(max = 200.dp)) {
            Text(f.name, fontSize = 14.sp, color = fg, maxLines = 2, overflow = TextOverflow.Ellipsis)
            val state = progress?.let { "下载中 ${(it * PCT_SCALE).toInt()}%" } ?: if (local != null) "点击打开" else "点击下载"
            Text("${FileTransfer.sizeText(f.size)} · $state", fontSize = 11.sp, color = fg.copy(alpha = 0.65f))
        }
    }
}

@Composable
private fun thumb(file: File?): ImageBitmap? {
    val state by produceState<ImageBitmap?>(null, file) {
        value = file?.let { withContext(Dispatchers.IO) { runCatching { decode(it) }.getOrNull() } }
    }
    return state
}

// 按目标尺寸采样解码, 大图不会撑爆内存
private fun decode(file: File): ImageBitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.path, bounds)
    var sample = 1
    while (bounds.outWidth / (sample * 2) >= THUMB_PX || bounds.outHeight / (sample * 2) >= THUMB_PX) sample *= 2
    return BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample })?.asImageBitmap()
}

private fun extOf(name: String): String = name.substringAfterLast('.', "").take(4).uppercase().ifEmpty { "FILE" }
