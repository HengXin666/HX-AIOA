package com.hengxin.aioa.browser

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.net.Uri
import android.os.Bundle
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
import androidx.lifecycle.lifecycleScope
import com.hengxin.aioa.config.AppearanceStore
import com.hengxin.aioa.kit.AioaTheme
import kotlinx.coroutines.launch

/**
 * 内置迷你浏览器: 同一个 WebView 复用到关掉为止, 登录态全 App 共享并持久保存,
 * 配了订阅就走内置代理, 拦截常见广告域名。
 */
class BrowserActivity : ComponentActivity() {
    private val page = PageState()
    private lateinit var web: WebView
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
        web = createWebView(this, page, BrowserHooks(::keepProxy, ::chooseFile))
        val restored = savedInstanceState?.let { web.restoreState(it) } != null
        if (!restored) queued = intent.getStringExtra(Browser.EXTRA_URL)
        // 先把代理设好再加载, 否则首个请求可能直连出去
        lifecycleScope.launch {
            page.proxied = BrowserProxy.apply(this@BrowserActivity)
            ready = true
            queued?.let(::load)
            queued = null
        }
        setContent {
            val appearance = AppearanceStore.load(this).resolve(isSystemInDarkTheme())
            AioaTheme(appearance) {
                BackHandler { if (web.canGoBack()) web.goBack() else finish() }
                BrowserScreen(web, page, BrowserActions(::finish, ::load, ::reloadOrStop, ::copyLink, ::openExternal))
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.getStringExtra(Browser.EXTRA_URL)?.let { if (ready) load(it) else queued = it }
    }

    override fun onResume() {
        super.onResume()
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
