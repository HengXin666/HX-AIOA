package com.hengxin.aioa.ui.chat

import android.annotation.SuppressLint
import android.content.Context
import android.view.MotionEvent
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.text.HtmlCompat
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Icon
import kotlinx.coroutines.launch

private const val BODY_MIN = 120
// 远程图片晚到会撑高页面, 分几次重新量
private val MEASURE_AT = longArrayOf(60, 400, 1500, 4000)
private val REMOTE_IMG = Regex("<img[^>]+src\\s*=\\s*[\"']?https?:", RegexOption.IGNORE_CASE)
private val HIDDEN = Regex("<(style|script|head|title)[^>]*>[\\s\\S]*?</\\1>", RegexOption.IGNORE_CASE)
private val VIEWPORT = Regex("<meta[^>]+viewport[^>]*>", RegexOption.IGNORE_CASE)
private val BLANKS = Regex("\\n{3,}")
private val SCHEMES = setOf("http", "https", "mailto")
private const val MIME = "text/html"
private const val UTF8 = "utf-8"

// 深色适配: 整页反色再转回色相, 图片与背景图再反一次保持原样
private const val INVERT = "html{filter:invert(1) hue-rotate(180deg)}img,picture,video,svg,[style*=\"background-image\"],[background]{filter:invert(1) hue-rotate(180deg)}"
// 按屏宽排版: 固定 600px 的表格与大图缩到屏宽, 不出现横向滚动
private const val FIT = "html{background:#fff;color:#222}body{margin:0;padding:12px;overflow-x:hidden;word-wrap:break-word}" +
    "img{max-width:100%!important;height:auto!important}table{max-width:100%!important}table[width]{width:100%!important}" +
    "td,th{word-break:break-word}pre{white-space:pre-wrap}"

/** 纯文本: 去掉样式与脚本后转成文字。 */
fun mailPlain(html: String): String =
    HtmlCompat.fromHtml(html.replace(HIDDEN, ""), HtmlCompat.FROM_HTML_MODE_COMPACT).toString().replace(BLANKS, "\n\n").trim()

/** 正文: 有原文就内嵌显示 (远程图片按偏好拦截, 深色适配), 没有就显示摘要; 点链接交给 onLink。 */
@Composable
fun MailBody(m: MailItem, s: MailState, onLink: (String) -> Unit) {
    val c = Aioa.colors
    val scope = rememberCoroutineScope()
    var html by remember(m.id) { mutableStateOf(s.bodies[m.id]) }
    var err by remember(m.id) { mutableStateOf<String?>(null) }
    var once by remember(m.id) { mutableStateOf(false) }
    LaunchedEffect(m.id) {
        if (m.body != null && html == null) s.api.body(m.id).onSuccess { s.bodies[m.id] = it; html = it }.onFailure { err = it.message }
    }
    val page = html
    if (page == null) {
        Column(Modifier.fillMaxWidth().background(c.surface).padding(MAIL_PAD.dp)) {
            SelectionContainer { Text(m.summary.ifEmpty { "(没有正文)" }, color = c.text, fontSize = 14.sp, lineHeight = 22.sp) }
            if (m.body != null) Text(err ?: "正在加载原文...", Modifier.padding(top = 10.dp), color = if (err != null) c.danger else c.textSecondary, fontSize = 12.sp)
        }
        return
    }
    val site = MailAddr.site(m.from)
    val style = s.prefs.style(m.from)
    val show = once || s.prefs.imagesAllowed(m.from, m.spoof)
    val blocked = if (show) 0 else REMOTE_IMG.findAll(page).count()
    fun setPref(p: MailSenderPref) = scope.launch { s.savePrefs(s.prefs.withSender(site, p)) }
    if (blocked > 0) {
        Row(Modifier.padding(horizontal = 12.dp, vertical = 8.dp).fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(c.surface).padding(horizontal = 12.dp, vertical = 9.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon("eye-off", c.textSecondary, 16.dp)
            Text("已拦截 $blocked 张远程图片", Modifier.padding(start = 8.dp).weight(1f), color = c.textSecondary, fontSize = 12.sp)
            Text("显示", Modifier.clip(RoundedCornerShape(6.dp)).clickable { once = true }.padding(6.dp), color = c.accent, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            Text("总是显示", Modifier.clip(RoundedCornerShape(6.dp)).clickable { setPref(s.prefs.pref(m.from).copy(images = SHOW)) }.padding(6.dp), color = c.accent, fontSize = 13.sp)
        }
    }
    Column(Modifier.fillMaxWidth().background(c.surface).padding(top = 8.dp)) {
        Row(Modifier.padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            STYLE_LABEL.forEach { (k, label) ->
                val on = k == style
                Text(label, Modifier.clip(RoundedCornerShape(12.dp)).background(if (on) c.accent.copy(alpha = 0.12f) else c.surfaceAlt)
                    .clickable { if (!on) setPref(s.prefs.pref(m.from).copy(style = k.takeIf { it != STYLE_ADAPT })) }.padding(horizontal = 10.dp, vertical = 4.dp),
                    color = if (on) c.accent else c.textSecondary, fontSize = 12.sp, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal)
            }
        }
        if (style == STYLE_TEXT) {
            val text = remember(page) { mailPlain(page) }
            SelectionContainer { Text(text, Modifier.padding(MAIL_PAD.dp), color = c.text, fontSize = 14.sp, lineHeight = 22.sp) }
        } else {
            val dark = cardTheme().dark
            MailWeb(page, show, dark && style == STYLE_ADAPT, onLink)
        }
    }
}

@SuppressLint("ClickableViewAccessibility")
@Composable
private fun MailWeb(html: String, images: Boolean, invert: Boolean, onLink: (String) -> Unit) {
    var height by remember(html) { mutableIntStateOf(BODY_MIN) }
    val key = "$images/$invert/${html.hashCode()}"
    AndroidView(
        factory = { ctx -> mailWebView(ctx, onLink) { h -> height = maxOf(h, BODY_MIN) } },
        update = { w ->
            if (w.tag != key) {
                w.tag = key
                w.settings.blockNetworkLoads = !images
                w.loadDataWithBaseURL(null, mailPage(html, invert), MIME, UTF8, null)
            }
        },
        modifier = Modifier.padding(8.dp).fillMaxWidth().clip(RoundedCornerShape(10.dp)).height(height.dp),
    )
}

private fun mailPage(body: String, invert: Boolean) =
    "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
        "<style>$FIT${if (invert) INVERT else ""}</style></head><body>${body.replace(VIEWPORT, "")}</body></html>"

/** 邮件原文 WebView: 不跑脚本, 不读文件, 远程资源按偏好放行; 拖动交给外层滚动, 点链接交给外面处理。 */
@SuppressLint("ClickableViewAccessibility")
private fun mailWebView(context: Context, onLink: (String) -> Unit, onHeight: (Int) -> Unit): WebView = WebView(context).apply {
    settings.javaScriptEnabled = false
    settings.allowFileAccess = false
    settings.allowContentAccess = false
    settings.blockNetworkLoads = true
    isVerticalScrollBarEnabled = false
    isHorizontalScrollBarEnabled = false
    setOnTouchListener { _, e -> e.actionMasked == MotionEvent.ACTION_MOVE }
    webViewClient = object : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (request.url.scheme in SCHEMES) onLink(request.url.toString())
            return true
        }

        override fun onPageFinished(view: WebView, url: String?) {
            MEASURE_AT.forEach { ms -> view.postDelayed({ onHeight(view.contentHeight) }, ms) }
        }
    }
}
