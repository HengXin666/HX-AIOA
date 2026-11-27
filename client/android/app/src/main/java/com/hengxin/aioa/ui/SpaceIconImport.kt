package com.hengxin.aioa.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import android.net.Uri
import com.hengxin.aioa.kit.IconRef
import com.hengxin.aioa.net.ApiCache
import com.hengxin.aioa.ui.chat.Avatars
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream

// 自选图标上传 (#142): 复用头像接口 (PUT /avatars, 按内容哈希存, 重复上传不多写, 上限 64KB)。
// PNG / JPEG / WebP 解码后缩进 96x96 透明方块重新编成 PNG (顺带丢掉 EXIF 等元数据);
// SVG 不传原文, 在本机光栅化 ([SvgRaster]) 成 PNG; 单色的引用写 svg:<id> (跟主题着色), 其余 img:<id> (原色)。
object SpaceIconImport {
    private const val SIDE = 96
    private const val MAX_RASTER_BYTES = 8 * 1024 * 1024
    private const val MAX_SVG_BYTES = 64 * 1024
    private const val MAX_UPLOAD = 64 * 1024
    private const val PATH = "api/v1/avatars"
    private const val PNG = "image/png"
    private const val SVG = "image/svg+xml"
    private const val WEBP_QUALITY = 90
    const val MIMES_HINT = "PNG, JPEG, WebP 或 SVG"
    val MIMES = arrayOf(PNG, "image/jpeg", "image/webp", SVG)

    /** 读入, 处理, 上传; 成功返回图标引用。 */
    suspend fun import(context: Context, uri: Uri): Result<String> = withContext(Dispatchers.IO) {
        runCatching {
            val resolver = context.contentResolver
            val svg = resolver.getType(uri) == SVG || uri.lastPathSegment.orEmpty().endsWith(".svg", ignoreCase = true)
            val limit = if (svg) MAX_SVG_BYTES else MAX_RASTER_BYTES
            val bytes = resolver.openInputStream(uri)?.use { it.readNBytesCompat(limit + 1) } ?: error("读不到这个文件")
            require(bytes.size <= limit) { if (svg) "SVG 不能超过 ${MAX_SVG_BYTES / 1024}KB" else "图片不能超过 ${MAX_RASTER_BYTES / 1024 / 1024}MB" }
            val (bmp, mono) = if (svg) SvgRaster.render(bytes, SIDE) else fit(bytes) to false
            val data = encode(bmp)
            require(data.size <= MAX_UPLOAD) { "图标压缩后还是太大" }
            val r = ApiCache.upload(context, listOf(PATH), data, if (data.isWebp()) "image/webp" else PNG)
            val id = r.body?.optString("id")?.ifEmpty { null } ?: error(r.error ?: "上传失败")
            Avatars.put(context, id, data)
            (if (mono) IconRef.MONO else IconRef.IMG) + id
        }
    }

    /** 位图缩进 SIDE x SIDE 的透明方块, 保持比例居中。 */
    private fun fit(bytes: ByteArray): Bitmap {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        require(bounds.outWidth > 0 && bounds.outHeight > 0) { "不是能识别的图片" }
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= SIDE * 2) sample *= 2
        val src = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample }) ?: error("不是能识别的图片")
        val scale = minOf(SIDE.toFloat() / src.width, SIDE.toFloat() / src.height)
        val w = (src.width * scale).toInt().coerceAtLeast(1)
        val h = (src.height * scale).toInt().coerceAtLeast(1)
        val out = Bitmap.createBitmap(SIDE, SIDE, Bitmap.Config.ARGB_8888)
        val left = (SIDE - w) / 2
        val top = (SIDE - h) / 2
        Canvas(out).drawBitmap(src, null, Rect(left, top, left + w, top + h), Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG))
        return out
    }

    /** 先 PNG (无损, 带透明); 超过上限再用 WebP。 */
    private fun encode(bmp: Bitmap): ByteArray {
        val png = ByteArrayOutputStream().also { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
        if (png.size <= MAX_UPLOAD) return png
        @Suppress("DEPRECATION")
        val format = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) Bitmap.CompressFormat.WEBP_LOSSY else Bitmap.CompressFormat.WEBP
        return ByteArrayOutputStream().also { bmp.compress(format, WEBP_QUALITY, it) }.toByteArray()
    }

    private fun ByteArray.isWebp() = size > 12 && this[8] == 'W'.code.toByte() && this[9] == 'E'.code.toByte() && this[10] == 'B'.code.toByte() && this[11] == 'P'.code.toByte()

    private fun java.io.InputStream.readNBytesCompat(n: Int): ByteArray {
        val out = ByteArrayOutputStream()
        val buf = ByteArray(8192)
        var left = n
        while (left > 0) {
            val r = read(buf, 0, minOf(buf.size, left))
            if (r < 0) break
            out.write(buf, 0, r)
            left -= r
        }
        return out.toByteArray()
    }
}
