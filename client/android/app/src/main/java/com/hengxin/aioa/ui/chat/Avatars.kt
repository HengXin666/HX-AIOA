package com.hengxin.aioa.ui.chat

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
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
    private const val MAX_BYTES = 60 * 1024
    private const val START_QUALITY = 90
    private const val QUALITY_STEP = 10
    private const val MIN_QUALITY = 30
    const val MIME = "image/webp"

    private val mem = LruCache<String, ImageBitmap>(MEM_ITEMS)

    fun cached(id: String): ImageBitmap? = mem.get(id)

    suspend fun load(context: Context, id: String): ImageBitmap? = mem.get(id) ?: withContext(Dispatchers.IO) {
        val f = File(File(context.filesDir, DIR).apply { mkdirs() }, id)
        val bytes = if (f.exists()) f.readBytes() else ApiCache.bytes(context, listOf(PATH, id))?.also { f.writeBytes(it) }
        bytes?.let { BitmapFactory.decodeByteArray(it, 0, it.size) }?.asImageBitmap()?.also { mem.put(id, it) }
    }

    /** 选中的图片居中裁成正方形, 缩到 256px, 压成 WebP 直到不超过 60KB。 */
    suspend fun encode(context: Context, uri: Uri): ByteArray? = withContext(Dispatchers.IO) {
        val src = context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it) } ?: return@withContext null
        val side = minOf(src.width, src.height)
        val square = Bitmap.createBitmap(src, (src.width - side) / 2, (src.height - side) / 2, side, side)
        val scaled = Bitmap.createScaledBitmap(square, SIDE, SIDE, true)
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
