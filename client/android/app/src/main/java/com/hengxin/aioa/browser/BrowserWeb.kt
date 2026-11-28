package com.hengxin.aioa.browser

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/** 界面要显示的页面状态。 */
class PageState {
    var url by mutableStateOf("")
    var title by mutableStateOf("")
    var progress by mutableIntStateOf(0)
    var canBack by mutableStateOf(false)
    var canForward by mutableStateOf(false)
    var blocked by mutableIntStateOf(0)
    var proxied by mutableStateOf(false)
    var forceDark by mutableStateOf(false)
    val loading get() = progress in 1..99
}

class BrowserHooks(
    val onNavigate: () -> Unit,
    val chooseFile: (ValueCallback<Array<Uri>>, WebChromeClient.FileChooserParams) -> Boolean,
    // 进入新页面时按站点套用深色设置; 加载完记一条站点记录; 收到图标存本机
    val onStarted: (WebView, String) -> Unit,
    val onFinished: (String, String) -> Unit,
    val onIcon: (String, Bitmap) -> Unit,
)

// WebView 默认 UA 带 "; wv", 不少站点据此降级或拒绝登录; 去掉后按普通手机 Chrome 对待
private const val WV_MARK = "; wv"
private const val INTENT_SCHEME = "intent"
private const val FALLBACK_URL = "browser_fallback_url"
private const val FULL = 100

@SuppressLint("SetJavaScriptEnabled")
fun createWebView(context: Context, dark: Boolean, page: PageState, hooks: BrowserHooks): WebView = WebView(BrowserDark.themed(context, dark)).apply {
    settings.apply {
        javaScriptEnabled = true
        domStorageEnabled = true
        databaseEnabled = true
        loadWithOverviewMode = true
        useWideViewPort = true
        builtInZoomControls = true
        displayZoomControls = false
        setSupportMultipleWindows(false)
        mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        allowFileAccess = false
        allowContentAccess = false
        userAgentString = userAgentString.replace(WV_MARK, "")
    }
    // 所有 WebView 共用一份 Cookie / 本地存储, 登录一次处处有效, 重启 App 也保留
    CookieManager.getInstance().setAcceptCookie(true)
    CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
    webViewClient = Client(context, page, hooks)
    webChromeClient = Chrome(page, hooks)
    setDownloadListener { url, ua, disposition, mime, _ -> download(context, url, ua, disposition, mime) }
}

private class Client(val context: Context, val page: PageState, val hooks: BrowserHooks) : WebViewClient() {
    @Volatile private var pageHost: String? = null

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val uri = request.url
        if (Browser.isWeb(uri)) return false
        // 拉起其他 App 只认用户真点了的; 页面自动跳 xxapp:// 一律忽略
        if (!request.hasGesture()) return true
        if (uri.scheme == INTENT_SCHEME) {
            val intent = runCatching { Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME) }.getOrNull() ?: return true
            val opened = runCatching { context.startActivity(intent.addCategory(Intent.CATEGORY_BROWSABLE).setComponent(null)) }.isSuccess
            if (!opened) intent.getStringExtra(FALLBACK_URL)?.let(view::loadUrl)
            return true
        }
        Browser.external(context, uri)
        return true
    }

    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
        if (request.isForMainFrame) {
            pageHost = request.url.host
            return null
        }
        if (!BrowserRules.blocked(request.url.host, pageHost)) return null
        view.post { page.blocked++ }
        return BrowserRules.empty()
    }

    override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
        page.url = url
        page.blocked = 0
        hooks.onNavigate()
        hooks.onStarted(view, url)
        sync(view)
    }

    override fun onPageFinished(view: WebView, url: String) {
        page.url = url
        sync(view)
        CookieManager.getInstance().flush()
        hooks.onFinished(url, view.title.orEmpty())
    }

    override fun doUpdateVisitedHistory(view: WebView, url: String, isReload: Boolean) {
        page.url = url
        sync(view)
    }

    private fun sync(view: WebView) {
        page.canBack = view.canGoBack()
        page.canForward = view.canGoForward()
    }
}

private class Chrome(val page: PageState, val hooks: BrowserHooks) : WebChromeClient() {
    override fun onProgressChanged(view: WebView, newProgress: Int) {
        page.progress = if (newProgress >= FULL) 0 else newProgress
    }

    override fun onReceivedTitle(view: WebView, title: String?) {
        page.title = title.orEmpty()
    }

    override fun onReceivedIcon(view: WebView, icon: Bitmap?) {
        val url = view.url
        if (icon != null && url != null) hooks.onIcon(url, icon)
    }

    override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean =
        hooks.chooseFile(callback, params)
}

// 下载交给系统下载管理器, 带上本站 Cookie 以便下载需要登录的文件; 老系统交给外部
private fun download(context: Context, url: String, ua: String, disposition: String?, mime: String?) {
    val uri = Uri.parse(url)
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || !Browser.isWeb(uri)) return Browser.external(context, uri)
    val name = URLUtil.guessFileName(url, disposition, mime)
    val request = DownloadManager.Request(uri)
        .setMimeType(mime)
        .addRequestHeader("User-Agent", ua)
        .setTitle(name)
        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
        .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
    CookieManager.getInstance().getCookie(url)?.let { request.addRequestHeader("Cookie", it) }
    runCatching { context.getSystemService(DownloadManager::class.java).enqueue(request) }
        .onSuccess { Toast.makeText(context, "开始下载 $name", Toast.LENGTH_SHORT).show() }
        .onFailure { Browser.external(context, uri) }
}
