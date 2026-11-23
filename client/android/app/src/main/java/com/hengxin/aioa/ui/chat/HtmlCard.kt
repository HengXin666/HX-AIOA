package com.hengxin.aioa.ui.chat

import com.hengxin.aioa.browser.Browser
import android.annotation.SuppressLint
import android.content.Context
import android.util.LruCache
import android.view.MotionEvent
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

private const val MIME = "text/html"
private const val UTF8 = "utf-8"
private const val MIN_HEIGHT = 48
private const val HEIGHT_CACHE = 200
private val CARD_SHAPE = RoundedCornerShape(10.dp)
private val SCHEMES = setOf("http", "https")

private const val MQ_ON = "(min-width:0)"
private const val MQ_OFF = "(max-width:0)"
private val SCHEME_MQ = Regex("""\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)""", RegexOption.IGNORE_CASE)

/** 卡片跟随 App 的明暗: 没写颜色的部分用 App 文字色; 推送方写的 prefers-color-scheme 按 App 主题生效。 */
data class CardTheme(val dark: Boolean, val text: Int, val link: Int) {
    val key get() = "$dark/$text/$link"
}

@Composable
fun cardTheme(): CardTheme {
    val c = MaterialTheme.colorScheme
    return CardTheme(c.surface.luminance() < 0.5f, c.onSurface.toArgb(), c.primary.toArgb())
}

private fun css(argb: Int) = "#%06x".format(argb and 0xFFFFFF)

// 系统 WebView 的 prefers-color-scheme 跟系统走, 不跟 App 内主题, 所以按 App 主题改写成恒真/恒假
private fun adapt(body: String, dark: Boolean) =
    SCHEME_MQ.replace(body) { m -> if (m.groupValues[1].equals("dark", true) == dark) MQ_ON else MQ_OFF }

// 只给内容最基本的排版; 推送方的样式写在 HTML 里自己定
private fun page(body: String, t: CardTheme) =
    "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
        "<style>:root{color-scheme:${if (t.dark) "dark" else "light"}}html,body{margin:0;padding:0;word-wrap:break-word;color:${css(t.text)}}" +
        "a{color:${css(t.link)}}img{max-width:100%}</style></head><body>${adapt(body, t.dark)}</body></html>"

/** 沙箱 WebView: 不跑脚本, 不联网 (只能用内联样式和 data: 图片), 不读文件; 点链接进内置浏览器。 */
@SuppressLint("ClickableViewAccessibility")
private fun sandbox(context: Context, onHeight: (Int) -> Unit): WebView = WebView(context).apply {
    settings.javaScriptEnabled = false
    settings.allowFileAccess = false
    settings.allowContentAccess = false
    settings.blockNetworkLoads = true
    setBackgroundColor(android.graphics.Color.TRANSPARENT)
    isVerticalScrollBarEnabled = false
    webViewClient = object : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url
            if (url.scheme in SCHEMES) Browser.open(context, url.toString())
            return true
        }

        override fun onPageFinished(view: WebView, url: String?) {
            view.postDelayed({ onHeight(view.contentHeight) }, 50)
        }
    }
}

private fun WebView.show(html: String, t: CardTheme) {
    val key = t.key + html
    if (tag == key) return
    tag = key
    loadDataWithBaseURL(null, page(html, t), MIME, UTF8, null)
}

// 量过的高度按内容记住: 列表回收后重新进屏直接用旧高度, 不再从最小值长回去把相邻消息顶开
private val heights = LruCache<String, Int>(HEIGHT_CACHE)

private fun heightKey(html: String, width: Int) = "${html.hashCode()}/${html.length}/$width"

/** 消息里的 HTML 卡片: 内联最多 maxHeight 高, 超出可全屏看; 卡片内滑动交给外层列表。
 *  footer 放在 "全屏" 同一行的右侧 (比如消息时间), 省掉单独一行留白。 */
@SuppressLint("ClickableViewAccessibility")
@Composable
fun HtmlCard(html: String, modifier: Modifier = Modifier, maxHeight: Dp = 420.dp, footer: (@Composable () -> Unit)? = null) {
    val width = LocalConfiguration.current.screenWidthDp
    val key = heightKey(html, width)
    var height by remember(key) { mutableIntStateOf(heights.get(key) ?: MIN_HEIGHT) }
    var full by remember { mutableStateOf(false) }
    val theme = cardTheme()
    val tall = height > maxHeight.value
    Column(modifier.fillMaxWidth()) {
        Box(Modifier.fillMaxWidth().clip(CARD_SHAPE)) {
            AndroidView(
                factory = { ctx ->
                    sandbox(ctx) { h -> maxOf(h, MIN_HEIGHT).let { height = it; heights.put(key, it) } }.apply {
                        // 拖动不让 WebView 自己滚, 外层列表才能接住; 点按照常处理链接
                        setOnTouchListener { _, e -> e.actionMasked == MotionEvent.ACTION_MOVE }
                    }
                },
                update = { it.show(html, theme) },
                modifier = Modifier.fillMaxWidth().height(minOf(height.toFloat(), maxHeight.value).dp),
            )
        }
        Row(Modifier.fillMaxWidth().padding(top = 2.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                if (tall) "展开全部" else "全屏",
                Modifier.clip(RoundedCornerShape(6.dp)).clickable { full = true }.padding(end = 6.dp, top = 1.dp, bottom = 1.dp),
                fontSize = 11.sp,
                color = MaterialTheme.colorScheme.primary,
            )
            Spacer(Modifier.weight(1f))
            footer?.invoke()
        }
    }
    if (full) HtmlViewer(html) { full = false }
}

/** 全屏看 HTML: 可以在里面滚动。 */
@Composable
fun HtmlViewer(html: String, title: String = "卡片", onClose: () -> Unit) {
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        BackHandler(onBack = onClose)
        val theme = cardTheme()
        Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface).systemBarsPadding()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(title, Modifier.weight(1f), fontSize = 16.sp, color = MaterialTheme.colorScheme.onSurface)
                Text("关闭", Modifier.clickable(onClick = onClose), fontSize = 14.sp, color = MaterialTheme.colorScheme.primary)
            }
            AndroidView({ ctx -> sandbox(ctx) {} }, Modifier.fillMaxWidth().weight(1f).background(Color.Transparent), update = { it.show(html, theme) })
        }
    }
}
