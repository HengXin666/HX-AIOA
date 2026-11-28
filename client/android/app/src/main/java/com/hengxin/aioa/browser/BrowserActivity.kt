package com.hengxin.aioa.browser

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.lifecycleScope
import com.hengxin.aioa.config.AppearancePrefs
import com.hengxin.aioa.config.AppearanceStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * 内置迷你浏览器: 同一个 WebView 复用到关掉为止, 登录态全 App 共享并持久保存,
 * 配了订阅就走内置代理, 拦截常见广告域名; 明暗跟随 App 主题 (#143)。
 */
class BrowserActivity : ComponentActivity() {
    private val page = PageState()
    private lateinit var web: WebView
    private var webDark = false
    private var webGen by mutableIntStateOf(0)
    private var prefs by mutableStateOf(AppearancePrefs())
    private var pendingFiles: ValueCallback<Array<Uri>>? = null
    private var ready = false
    private var queued: String? = null

    private val pickFiles = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        pendingFiles?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
        pendingFiles = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        prefs = AppearanceStore.load(this)
        webDark = prefs.resolve(systemDark()).dark
        web = newWeb(webDark)
        val restored = savedInstanceState?.let { web.restoreState(it) } != null
        if (!restored) queued = intent.getStringExtra(Browser.EXTRA_URL)
        // 先把代理设好再加载, 否则首个请求可能直连出去
        lifecycleScope.launch {
            page.proxied = BrowserProxy.apply(this@BrowserActivity)
            ready = true
            queued?.let(::load)
            queued = null
        }
        val actions = BrowserActions(::finish, ::load, ::reloadOrStop, ::copyLink, ::openExternal, ::toggleForceDark, ::openSites, BrowserDark.supported())
        setContent {
            BrowserTheme(prefs) {
                val dark = prefs.resolve(isSystemInDarkTheme()).dark
                LaunchedEffect(dark) { switchDark(dark) }
                BackHandler { if (web.canGoBack()) web.goBack() else finish() }
                webGen
                BrowserScreen(web, page, actions)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.getStringExtra(Browser.EXTRA_URL)?.let { if (ready) load(it) else queued = it }
    }

    override fun onResume() {
        super.onResume()
        // 浏览器开着时可能去主界面改了主题, 回来重读
        prefs = AppearanceStore.load(this)
        web.onResume()
        keepProxy()
    }

    override fun onPause() {
        web.onPause()
        CookieManager.getInstance().flush()
        super.onPause()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onDestroy() {
        pendingFiles?.onReceiveValue(null)
        web.destroy()
        super.onDestroy()
    }

    private fun systemDark() =
        (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES

    private fun newWeb(dark: Boolean) =
        createWebView(this, dark, page, BrowserHooks(::keepProxy, ::chooseFile, ::onStarted, ::onFinished, ::onIcon))

    // 网页的 prefers-color-scheme 在创建 WebView 时定下, 明暗变了就换一个新的并恢复历史
    private fun switchDark(dark: Boolean) {
        if (dark == webDark) return
        val state = Bundle().also { web.saveState(it) }
        val old = web
        web = newWeb(dark)
        webDark = dark
        if (web.restoreState(state) == null && page.url.isNotEmpty()) web.loadUrl(page.url)
        webGen++
        (old.parent as? ViewGroup)?.removeView(old)
        old.destroy()
    }

    private fun onStarted(view: WebView, url: String) {
        val host = Uri.parse(url).host.orEmpty()
        page.forceDark = host.isNotEmpty() && SiteStore.forceDark(this, host)
        BrowserDark.apply(view, webDark, page.forceDark)
    }

    private fun onFinished(url: String, title: String) {
        val uri = Uri.parse(url)
        if (!Browser.isWeb(uri)) return
        val host = uri.host ?: return
        lifecycleScope.launch(Dispatchers.IO) {
            SiteStore.record(applicationContext, host, title, CookieManager.getInstance().getCookie(url))
        }
    }

    private fun onIcon(url: String, icon: Bitmap) {
        val host = Uri.parse(url).host ?: return
        lifecycleScope.launch(Dispatchers.IO) { SiteStore.saveIcon(applicationContext, host, icon) }
    }

    private fun toggleForceDark() {
        val host = Uri.parse(page.url).host ?: return
        page.forceDark = !page.forceDark
        SiteStore.setForceDark(this, host, page.forceDark)
        BrowserDark.apply(web, webDark, page.forceDark)
        if (!webDark) Toast.makeText(this, "已记住, 深色主题下生效", Toast.LENGTH_SHORT).show() else web.reload()
    }

    private fun openSites() {
        val host = Uri.parse(page.url).host
        startActivity(BrowserSites.intent(this, host?.let(SiteRules::siteOf)))
    }

    private fun load(input: String) {
        val url = BrowserRules.resolve(input)
        if (url.isNotEmpty()) web.loadUrl(url)
    }

    private fun reloadOrStop() = if (page.loading) web.stopLoading() else web.reload()

    private fun keepProxy() {
        lifecycleScope.launch { BrowserProxy.keepAlive(this@BrowserActivity) }
    }

    private fun chooseFile(callback: ValueCallback<Array<Uri>>, params: WebChromeClient.FileChooserParams): Boolean {
        pendingFiles?.onReceiveValue(null)
        pendingFiles = callback
        return runCatching { pickFiles.launch(params.createIntent()) }.isSuccess.also { if (!it) pendingFiles = null }
    }

    private fun copyLink() {
        getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText("url", page.url))
        Toast.makeText(this, "已复制链接", Toast.LENGTH_SHORT).show()
    }

    private fun openExternal() {
        if (page.url.isNotEmpty()) Browser.external(this, Uri.parse(page.url))
    }
}
