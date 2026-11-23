package com.hengxin.aioa.ui.chat

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.util.LruCache
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.Dp
import com.hengxin.aioa.net.ApiCache
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File

// 头像按内容哈希命名, 永不变: 内存 LRU + 磁盘文件, 只在本地没有时下载一次
object Avatars {
    private const val DIR = "avatars"
    private const val PATH = "api/v1/avatars"
    private const val MEM_ITEMS = 64
    private const val SIDE = 256
    private const val MAX_DECODE = 2048
    private const val MAX_BYTES = 60 * 1024
    private const val START_QUALITY = 90
    private const val QUALITY_STEP = 10
    private const val MIN_QUALITY = 30
    private const val PRUNE_AGE_MS = 30L * 24 * 3600 * 1000
    const val MIME = "image/webp"

    private val mem = LruCache<String, ImageBitmap>(MEM_ITEMS)

    fun cached(id: String): ImageBitmap? = mem.get(id)

    /** 换掉的旧头像: 没人引用且一个月没用过的文件删掉。 */
    fun prune(context: Context, keep: Set<String>) {
        val cutoff = System.currentTimeMillis() - PRUNE_AGE_MS
        File(context.filesDir, DIR).listFiles()?.forEach { if (it.name !in keep && it.lastModified() < cutoff) it.delete() }
    }

    suspend fun load(context: Context, id: String): ImageBitmap? = mem.get(id) ?: withContext(Dispatchers.IO) {
        val f = File(File(context.filesDir, DIR).apply { mkdirs() }, id)
        val bytes = if (f.exists()) f.readBytes() else ApiCache.bytes(context, listOf(PATH, id))?.also { f.writeBytes(it) }
        bytes?.let { BitmapFactory.decodeByteArray(it, 0, it.size) }?.asImageBitmap()?.also { mem.put(id, it) }
    }

    /** 读入选中的图片: 按 EXIF 摆正, 长边先降到 2048px 以内, 免得大图撑爆内存。 */
    suspend fun decode(context: Context, uri: Uri): Bitmap? = withContext(Dispatchers.IO) {
        runCatching {
            val resolver = context.contentResolver
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
            var sample = 1
            while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= MAX_DECODE) sample *= 2
            val bmp = resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) } ?: return@runCatching null
            val turn = resolver.openInputStream(uri)?.use { exifDegrees(ExifInterface(it)) } ?: 0
            if (turn == 0) bmp else rotate(bmp, turn)
        }.getOrNull()
    }

    fun rotate(src: Bitmap, degrees: Int): Bitmap =
        Bitmap.createBitmap(src, 0, 0, src.width, src.height, Matrix().apply { postRotate(degrees.toFloat()) }, true)

    private fun exifDegrees(e: ExifInterface): Int = when (e.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
        ExifInterface.ORIENTATION_ROTATE_90 -> 90
        ExifInterface.ORIENTATION_ROTATE_180 -> 180
        ExifInterface.ORIENTATION_ROTATE_270 -> 270
        else -> 0
    }

    /** 按裁剪框 (位图坐标的正方形) 取图, 缩到 256px, 压成 WebP 直到不超过 60KB。 */
    suspend fun encode(src: Bitmap, left: Int, top: Int, side: Int): ByteArray = withContext(Dispatchers.Default) {
        val s = side.coerceIn(1, minOf(src.width, src.height))
        val x = left.coerceIn(0, src.width - s)
        val y = top.coerceIn(0, src.height - s)
        val scaled = Bitmap.createScaledBitmap(Bitmap.createBitmap(src, x, y, s, s), SIDE, SIDE, true)
        @Suppress("DEPRECATION")
        val format = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) Bitmap.CompressFormat.WEBP_LOSSY else Bitmap.CompressFormat.WEBP
        var q = START_QUALITY
        var bytes: ByteArray
        do {
            val out = ByteArrayOutputStream()
            scaled.compress(format, q, out)
            bytes = out.toByteArray()
            q -= QUALITY_STEP
        } while (bytes.size > MAX_BYTES && q >= MIN_QUALITY)
        bytes
    }

    suspend fun upload(context: Context, data: ByteArray): Result<String> = withContext(Dispatchers.IO) {
        val r = ApiCache.upload(context, listOf(PATH), data, MIME)
        r.body?.optString("id")?.ifEmpty { null }?.let { Result.success(it) } ?: Result.failure(Exception(r.error ?: "上传失败"))
    }
}

/** 群或人的头像: 有图片用图片, 没有 (或还在加载) 用字母头像。 */
@Composable
fun ChatAvatar(key: String, avatar: String?, size: Dp, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val img by produceState(avatar?.let { Avatars.cached(it) }, avatar) {
        value = avatar?.let { Avatars.load(context, it) }
    }
    val bmp = img
    if (bmp != null) {
        Image(bmp, key, modifier.size(size).clip(CircleShape), contentScale = ContentScale.Crop)
    } else {
        LetterAvatar(key, size, modifier)
    }
}
