package com.hengxin.aioa.ui.drive

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.widget.MediaController
import android.widget.VideoView
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.HxButton
import com.hengxin.aioa.kit.HxButtonSize
import com.hengxin.aioa.kit.HxButtonVariant
import com.hengxin.aioa.kit.ProgressLine
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.ui.hxoa.FullPage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File

private const val IMAGE_PX = 2048
private const val ZOOM_MAX = 5f
private const val TEXT_SP = 12
private const val PDF_RATIO = 0.707f

/** 加载状态: 进度 0..1, 结果, 错误。 */
private class Load<T>(val progress: Float = 0f, val value: T? = null, val error: String? = null)

/**
 * 预览页 (#158): 图片 (双指缩放), 文本 / 代码, PDF (系统 PdfRenderer), 音频与视频 (VideoView 播直链), 其他显示信息卡。
 * 内容走直链或 App 临时缓存, 不进下载目录; 底部是保存到手机, 分享链接, 发到群, 用其他应用打开。
 */
@Composable
internal fun PreviewPage(n: DriveNode, back: () -> Unit, show: (DriveDialog) -> Unit) {
    val context = LocalContext.current
    val task = DriveDownloads.tasks.firstOrNull { it.id == n.id }
    val saved = remember(task?.state) { DriveDownloads.saved(context, n) }
    FullPage(back, n.name, listOf(sizeText(n.size), timeText(n.updatedAt)).filter { it.isNotEmpty() }.joinToString(" · ")) {
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when (previewOf(n)) {
                Preview.IMAGE -> ImageBody(n)
                Preview.TEXT -> TextBody(n)
                Preview.PDF -> PdfBody(n)
                Preview.AUDIO, Preview.VIDEO -> MediaBody(n)
                Preview.INFO -> InfoCard(n)
            }
        }
        Column(Modifier.fillMaxWidth().background(Aioa.colors.surface).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (task != null && task.state == DlState.RUNNING) {
                ProgressLine(task.progress)
                Text("保存中 ${(task.progress * 100).toInt()}% · ${speedText(task.speed)} · ${etaText(etaSec(task.size - task.done, task.speed))}", Aioa.colors.textSecondary, 12)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                val label = when {
                    saved != null -> "打开"
                    task?.state == DlState.RUNNING -> "暂停"
                    task?.state == DlState.PAUSED || task?.state == DlState.FAILED -> "继续保存"
                    else -> "保存到手机"
                }
                HxButton(label, {
                    when {
                        task?.state == DlState.RUNNING && saved == null -> DriveDownloads.pause(context, task)
                        else -> DriveDownloads.save(context, n)
                    }
                }, Modifier.weight(1f), icon = if (saved != null) "external-link" else "download", size = HxButtonSize.Sm)
                HxButton("分享", { show(DriveDialog.Share(n)) }, icon = "link", size = HxButtonSize.Sm, variant = HxButtonVariant.Outline)
                HxButton("发到群", { show(DriveDialog.Send(n)) }, icon = "send", size = HxButtonSize.Sm, variant = HxButtonVariant.Outline)
                HxButton("", { openWithSystem(context, n) }, icon = "ellipsis", size = HxButtonSize.Sm, variant = HxButtonVariant.Outline)
            }
            if (saved != null) Text("已保存到 下载/AIOA", Aioa.colors.textSecondary, 12)
        }
    }
}

/** 整份文件下到预览缓存, 带进度。 */
@Composable
private fun cachedFile(n: DriveNode): Load<File> {
    val context = LocalContext.current
    val state by produceState(Load<File>(), n.id) {
        value = runCatching {
            PreviewCache.file(context, n) { b -> value = Load(b.toFloat() / n.size.coerceAtLeast(1)) }
        }.fold({ Load(1f, it) }, { Load(0f, null, it.message ?: "加载失败") })
    }
    return state
}

@Composable
private fun Loading(l: Load<*>, content: @Composable (Any) -> Unit) {
    val v = l.value
    when {
        l.error != null -> Center { Text(l.error, Aioa.colors.danger, 13, maxLines = 4) }
        v == null -> Center {
            Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(if (l.progress > 0f) "加载中 ${(l.progress * 100).toInt()}%" else "加载中...", Aioa.colors.textSecondary, 13)
                if (l.progress > 0f) ProgressLine(l.progress)
            }
        }
        else -> content(v)
    }
}

@Composable
private fun Center(content: @Composable () -> Unit) = Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { content() }

@Composable
private fun ImageBody(n: DriveNode) {
    val file = cachedFile(n)
    Loading(file) { f ->
        val img by produceState<Load<ImageBitmap>>(Load(1f), f) { value = withContext(Dispatchers.IO) { decode(f as File)?.let { Load(1f, it) } ?: Load(0f, null, "图片解码失败") } }
        Loading(img) { bmp -> ZoomImage(bmp as ImageBitmap) }
    }
}

/** 双指缩放与拖动, 双击复原。 */
@Composable
private fun ZoomImage(bmp: ImageBitmap) {
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    Box(Modifier.fillMaxSize().background(Color.Black)
        .pointerInput(Unit) { detectTapGestures(onDoubleTap = { scale = 1f; offset = Offset.Zero }) }
        .pointerInput(Unit) { detectTransformGestures { _, pan, zoom, _ -> scale = (scale * zoom).coerceIn(1f, ZOOM_MAX); offset = if (scale == 1f) Offset.Zero else offset + pan } }) {
        Image(bmp, null, Modifier.fillMaxSize().graphicsLayer(scaleX = scale, scaleY = scale, translationX = offset.x, translationY = offset.y), contentScale = ContentScale.Fit)
    }
}

private fun decode(file: File): ImageBitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.path, bounds)
    var sample = 1
    while (bounds.outWidth / (sample * 2) >= IMAGE_PX || bounds.outHeight / (sample * 2) >= IMAGE_PX) sample *= 2
    return BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample })?.asImageBitmap()
}

@Composable
private fun TextBody(n: DriveNode) {
    val context = LocalContext.current
    val l by produceState(Load<Pair<String, Boolean>>(), n.id) {
        value = runCatching { PreviewCache.text(context, n) }.fold({ Load(1f, it) }, { Load(0f, null, it.message ?: "读取失败") })
    }
    Loading(l) { v ->
        val pair = v as Pair<*, *>
        val text = pair.first as String
        val cut = pair.second == true
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).horizontalScroll(rememberScrollState()).padding(12.dp)) {
            if (cut) Text("只显示前 ${sizeText(TEXT_PREVIEW_MAX)}, 完整内容请保存或用其他应用打开", Aioa.colors.textSecondary, 12, maxLines = 2)
            SelectionContainer { androidx.compose.material3.Text(text, color = Aioa.colors.text, fontSize = TEXT_SP.sp, fontFamily = FontFamily.Monospace, softWrap = false) }
        }
    }
}

@Composable
private fun PdfBody(n: DriveNode) {
    val file = cachedFile(n)
    Loading(file) { f -> PdfPages(f as File) }
}

/** PDF 逐页渲染成图片, 按屏宽; 同一时间只渲染一页 (PdfRenderer 不允许并发)。 */
@Composable
private fun PdfPages(file: File) {
    val holder = remember(file) { runCatching { PdfRenderer(ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)) }.getOrNull() }
    val lock = remember { Mutex() }
    DisposableEffect(holder) { onDispose { holder?.close() } }
    if (holder == null) return Center { Text("PDF 打不开, 可以用其他应用打开", Aioa.colors.danger, 13) }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val px = with(LocalDensity.current) { maxWidth.roundToPx() }
        LazyColumn(Modifier.fillMaxSize().background(Aioa.colors.surfaceAlt), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(holder.pageCount) { i ->
                val page by produceState<ImageBitmap?>(null, i) {
                    value = withContext(Dispatchers.IO) { lock.withLock { runCatching { render(holder, i, px) }.getOrNull() } }
                }
                val p = page
                if (p == null) Box(Modifier.fillMaxWidth().aspectRatio(PDF_RATIO).background(Color.White))
                else Image(p, "第 ${i + 1} 页", Modifier.fillMaxWidth(), contentScale = ContentScale.FillWidth)
            }
        }
    }
}

private fun render(r: PdfRenderer, i: Int, width: Int): ImageBitmap = r.openPage(i).use { page ->
    val h = (width.toFloat() * page.height / page.width).toInt().coerceAtLeast(1)
    val bmp = Bitmap.createBitmap(width, h, Bitmap.Config.ARGB_8888)
    bmp.eraseColor(android.graphics.Color.WHITE)
    page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
    bmp.asImageBitmap()
}

/** 音频与视频: VideoView 直接播签名直链 (支持拖动), 播不了提示用其他应用打开。 */
@Composable
private fun MediaBody(n: DriveNode) {
    val context = LocalContext.current
    val url by produceState(Load<String>(), n.id) {
        value = runCatching { DriveTransfers.link(context, n) }.fold({ Load(1f, it) }, { Load(0f, null, it.message ?: "拿不到播放地址") })
    }
    var failed by remember { mutableStateOf(false) }
    val audio = previewOf(n) == Preview.AUDIO
    Loading(url) { u ->
        Column(Modifier.fillMaxSize().background(Color.Black), verticalArrangement = Arrangement.Center) {
            if (audio) Box(Modifier.fillMaxWidth().padding(24.dp)) { InfoCard(n) }
            if (failed) Text("这个格式 App 里放不了, 可以点右下角用其他应用打开", Color.White, 13, Modifier.padding(16.dp), maxLines = 3)
            AndroidView({ ctx ->
                VideoView(ctx).apply {
                    val mc = MediaController(ctx)
                    mc.setAnchorView(this)
                    setMediaController(mc)
                    setOnErrorListener { _, _, _ -> failed = true; true }
                    setOnPreparedListener { start(); mc.show() }
                    setVideoURI(Uri.parse(u as String))
                }
            }, Modifier.fillMaxWidth().then(if (audio) Modifier.height(72.dp) else Modifier.aspectRatio(16f / 9f)), onRelease = { it.stopPlayback() })
        }
    }
}

@Composable
private fun InfoCard(n: DriveNode) {
    val c = Aioa.colors
    Column(Modifier.fillMaxWidth().padding(16.dp).background(c.surface).padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(n.name, c.text, 15, maxLines = 3)
        InfoLine("大小", sizeText(n.size))
        InfoLine("类型", n.mime.ifEmpty { extOf(n.name).ifEmpty { "未知" } })
        if (n.updatedAt > 0) InfoLine("修改时间", timeText(n.updatedAt))
        if (n.path.isNotEmpty()) InfoLine("位置", DrivePaths.parent(n.path))
        if (previewOf(n) == Preview.INFO) Text("这种文件不能在 App 里预览, 可以保存到手机或用其他应用打开", c.textSecondary, 12, maxLines = 3)
    }
}

@Composable
private fun ColumnScope.InfoLine(k: String, v: String) {
    Row { Text(k, Aioa.colors.textSecondary, 13, Modifier.weight(0.3f)); Text(v, Aioa.colors.text, 13, Modifier.weight(0.7f), maxLines = 2) }
}
