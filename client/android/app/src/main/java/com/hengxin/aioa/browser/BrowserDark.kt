package com.hengxin.aioa.browser

import android.content.Context
import android.view.ContextThemeWrapper
import android.webkit.WebView
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature

/**
 * 网页深色 (#143)。targetSdk >= 33 时 prefers-color-scheme 跟 WebView 所在 Context 主题的 isLightTheme 走,
 * 所以 WebView 用按 App 主题包过的 Context 创建; 没有深色样式的站点只在 "此站强制深色" 时算法变暗。
 * 旧 WebView 走 FORCE_DARK; 都不支持就什么也不做。
 */
object BrowserDark {
    /** 给 WebView 用的 Context: 主题明暗与 App 一致。 */
    fun themed(context: Context, dark: Boolean): Context = ContextThemeWrapper(
        context,
        if (dark) android.R.style.Theme_Material_NoActionBar else android.R.style.Theme_Material_Light_NoActionBar,
    )

    fun supported(): Boolean =
        WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING) || WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK)

    /** 每次导航到新站点或切换开关时调用。 */
    @Suppress("DEPRECATION")
    fun apply(web: WebView, dark: Boolean, forceSite: Boolean) {
        val s = web.settings
        runCatching {
            if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
                WebSettingsCompat.setAlgorithmicDarkeningAllowed(s, dark && forceSite)
                return
            }
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK)) return
            WebSettingsCompat.setForceDark(s, if (dark) WebSettingsCompat.FORCE_DARK_ON else WebSettingsCompat.FORCE_DARK_OFF)
            if (WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK_STRATEGY)) {
                // 有站点深色样式优先用站点的; 不强制时只认站点自己的深色, 不反色
                val strategy = if (forceSite) {
                    WebSettingsCompat.DARK_STRATEGY_PREFER_WEB_THEME_OVER_USER_AGENT_DARKENING
                } else {
                    WebSettingsCompat.DARK_STRATEGY_WEB_THEME_DARKENING_ONLY
                }
                WebSettingsCompat.setForceDarkStrategy(s, strategy)
            }
        }
    }
}
