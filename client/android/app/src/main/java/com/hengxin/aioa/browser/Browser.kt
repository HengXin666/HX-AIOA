package com.hengxin.aioa.browser

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.compose.ui.platform.UriHandler

// App 内所有链接的统一入口: http(s) 进内置浏览器, 其他协议交给系统
object Browser {
    const val EXTRA_URL = "url"
    private val WEB_SCHEMES = setOf("http", "https")

    fun isWeb(uri: Uri?): Boolean = uri?.scheme?.lowercase() in WEB_SCHEMES

    fun intent(context: Context, url: String): Intent =
        Intent(context, BrowserActivity::class.java).putExtra(EXTRA_URL, url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    fun open(context: Context, url: String?) {
        if (url.isNullOrBlank()) return
        val uri = runCatching { Uri.parse(url.trim()) }.getOrNull() ?: return
        if (isWeb(uri)) context.startActivity(intent(context, uri.toString())) else external(context, uri)
    }

    /** 交给系统 (外部浏览器或对应 App)。 */
    fun external(context: Context, uri: Uri) {
        runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            .onFailure { Toast.makeText(context, "没有可以打开链接的应用", Toast.LENGTH_SHORT).show() }
    }
}

/** 给 Compose 文本链接 (Markdown 等) 用, 装在界面根部。 */
class BrowserUriHandler(private val context: Context) : UriHandler {
    override fun openUri(uri: String) = Browser.open(context, uri)
}
