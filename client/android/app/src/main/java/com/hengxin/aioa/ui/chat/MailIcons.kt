package com.hengxin.aioa.ui.chat

import android.content.Context
import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.net.ApiCache
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.math.abs

/** 发件方网站图标: 服务端按主域名代理; 本地内存 + 磁盘缓存, 没有图标的也记下 (1 天后再试)。 */
object MailIcons {
    private const val DIR = "mail-icons"
    private const val PATH = "api/v1/mail/icon"
    private const val MEM_ITEMS = 96
    private const val HIT_TTL_MS = 7L * 86_400_000
    private const val MISS_TTL_MS = 86_400_000L
    private const val MISS_EXT = ".none"
    private val mem = LruCache<String, ImageBitmap>(MEM_ITEMS)
    private val miss = mutableSetOf<String>()

    fun cached(site: String): ImageBitmap? = mem.get(site)

    suspend fun load(context: Context, site: String): ImageBitmap? {
        if (site.isEmpty() || site in miss) return null
        mem.get(site)?.let { return it }
        return withContext(Dispatchers.IO) {
            val dir = File(context.cacheDir, DIR).apply { mkdirs() }
            val f = File(dir, "$site.png")
            val none = File(dir, site + MISS_EXT)
            val now = System.currentTimeMillis()
            if (none.exists() && now - none.lastModified() < MISS_TTL_MS) return@withContext null.also { miss.add(site) }
            val bytes = if (f.exists() && now - f.lastModified() < HIT_TTL_MS) f.readBytes()
            else ApiCache.bytes(context, listOf(PATH, site))?.also { f.writeBytes(it); none.delete() }
            val bmp = bytes?.let { BitmapFactory.decodeByteArray(it, 0, it.size) }?.asImageBitmap()
            if (bmp == null) { none.writeText(""); miss.add(site) } else mem.put(site, bmp)
            bmp
        }
    }
}

// 首字母头像的底色, 按名字散列, 同一个发件人每次一样
private val LETTER_COLORS = listOf(0xFF2F6BFF, 0xFF7C3AED, 0xFF0EA5E9, 0xFF10A37F, 0xFFEA580C, 0xFFE11D48, 0xFF64748B).map { Color(it) }

/** 圆形头像: 有网站图标用图标 (白底细边), 没有用首字母。 */
@Composable
fun MailAvatar(addr: String, label: String, size: Dp, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val site = remember(addr) { MailAddr.site(addr) }
    var img by remember(site) { mutableStateOf(MailIcons.cached(site)) }
    LaunchedEffect(site) { if (img == null) img = MailIcons.load(context.applicationContext, site) }
    val c = Aioa.colors
    val shape = CircleShape
    val icon = img
    if (icon != null) {
        Box(modifier.size(size).clip(shape).background(Color.White).border(1.dp, c.border, shape), contentAlignment = Alignment.Center) {
            Image(icon, null, Modifier.size(size * ICON_RATIO))
        }
    } else {
        val ch = label.trim().firstOrNull { it.isLetterOrDigit() }?.uppercase() ?: "?"
        Box(modifier.size(size).clip(shape).background(LETTER_COLORS[abs(label.hashCode()) % LETTER_COLORS.size]), contentAlignment = Alignment.Center) {
            Text(ch, color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = (size.value * LETTER_RATIO).sp)
        }
    }
}

private const val ICON_RATIO = 0.62f
private const val LETTER_RATIO = 0.42f
