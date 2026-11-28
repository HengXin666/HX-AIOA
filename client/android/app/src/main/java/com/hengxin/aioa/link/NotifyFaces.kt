package com.hengxin.aioa.link

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Shader
import android.graphics.Typeface
import android.util.LruCache
import androidx.core.graphics.drawable.IconCompat
import com.hengxin.aioa.data.AvatarIndex
import java.io.File

/**
 * 通知里的圆形头像 (#151), 运行在 :link 进程: 头像 id 查 [AvatarIndex], 图片读界面进程的磁盘缓存;
 * 本地没有就画文字头像, 不为通知联网。配色与首字规则和 ui/chat/Avatar.kt 一致 (那边依赖 Compose, 这里不能引用)。
 */
object NotifyFaces {
    // 与 ui/chat/Avatars 的磁盘目录一致
    private const val DIR = "avatars"
    private const val SIDE = 128
    private const val MEM_ITEMS = 32
    private const val FONT_RATIO = 0.42f
    private const val NO_INITIAL = "#"
    private const val LETTER_PREFIX = "letter:"
    private const val SEP = "\u0000"
    private val PALETTE = longArrayOf(0xFFE17076, 0xFFFAA774, 0xFFA695E7, 0xFF7BC862, 0xFF6EC9CB, 0xFF65AADD, 0xFFEE7AAE, 0xFFD4A04C)
    private val mem = LruCache<String, Bitmap>(MEM_ITEMS)

    /** 群或单聊会话的头像: 群资料头像 > 同名来源的发送者头像 > 文字头像。 */
    fun group(context: Context, key: String, title: String): IconCompat =
        IconCompat.createWithBitmap(bitmap(context, AvatarIndex.group(context, key) ?: AvatarIndex.sender(context, key), key, title))

    fun sender(context: Context, sid: String?, name: String): IconCompat =
        IconCompat.createWithBitmap(bitmap(context, sid?.let { AvatarIndex.sender(context, it) }, name, name))

    /** 头像 id 用来判断会话快捷方式要不要重推。 */
    fun groupAvatarId(context: Context, key: String): String? = AvatarIndex.group(context, key) ?: AvatarIndex.sender(context, key)

    private fun bitmap(context: Context, id: String?, colorKey: String, label: String): Bitmap {
        id?.let { i -> (mem.get(i) ?: decode(context, i)?.also { mem.put(i, it) })?.let { return it } }
        val k = LETTER_PREFIX + colorKey + SEP + label
        return mem.get(k) ?: letter(colorKey, label).also { mem.put(k, it) }
    }

    private fun decode(context: Context, id: String): Bitmap? = runCatching {
        val f = File(File(context.filesDir, DIR), id)
        if (!f.exists()) return null
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(f.path, bounds)
        var sample = 1
        while (minOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= SIDE) sample *= 2
        BitmapFactory.decodeFile(f.path, BitmapFactory.Options().apply { inSampleSize = sample })?.let(::circle)
    }.getOrNull()

    // 居中裁成正方形再画进圆里
    private fun circle(src: Bitmap): Bitmap {
        val out = Bitmap.createBitmap(SIDE, SIDE, Bitmap.Config.ARGB_8888)
        val side = minOf(src.width, src.height).toFloat()
        val scale = SIDE / side
        val m = Matrix().apply {
            postTranslate(-(src.width - side) / 2f, -(src.height - side) / 2f)
            postScale(scale, scale)
        }
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { shader = BitmapShader(src, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP).apply { setLocalMatrix(m) } }
        Canvas(out).drawCircle(SIDE / 2f, SIDE / 2f, SIDE / 2f, paint)
        return out
    }

    private fun letter(colorKey: String, label: String): Bitmap {
        val out = Bitmap.createBitmap(SIDE, SIDE, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(out)
        val bg = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = PALETTE[Math.floorMod(colorKey.hashCode(), PALETTE.size)].toInt() }
        canvas.drawCircle(SIDE / 2f, SIDE / 2f, SIDE / 2f, bg)
        val text = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = android.graphics.Color.WHITE
            textSize = SIDE * FONT_RATIO
            textAlign = Paint.Align.CENTER
            typeface = Typeface.DEFAULT_BOLD
        }
        canvas.drawText(initial(label), SIDE / 2f, SIDE / 2f - (text.ascent() + text.descent()) / 2f, text)
        return out
    }

    private fun initial(key: String): String =
        key.substringAfterLast('/').trim().firstOrNull { it.isLetterOrDigit() }?.uppercase() ?: NO_INITIAL

}
