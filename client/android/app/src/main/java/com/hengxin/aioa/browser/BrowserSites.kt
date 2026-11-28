package com.hengxin.aioa.browser

import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.hengxin.aioa.config.AppearancePrefs
import com.hengxin.aioa.config.AppearanceStore
import com.hengxin.aioa.kit.Aioa

const val SITES_TITLE = "网站与登录"

/** "网站与登录" 页的入口: 设置和浏览器菜单都从这里打开。 */
object BrowserSites {
    private const val EXTRA_SITE = "site"

    fun intent(context: Context, current: String? = null): Intent =
        Intent(context, BrowserSitesActivity::class.java).putExtra(EXTRA_SITE, current)

    fun open(context: Context) = context.startActivity(intent(context))

    fun current(intent: Intent): String? = intent.getStringExtra(EXTRA_SITE)
}

/** 独立页面, 返回即关掉, 回到打开它的地方 (设置或浏览器)。 */
class BrowserSitesActivity : ComponentActivity() {
    private var prefs by mutableStateOf(AppearancePrefs())
    private var tick by mutableIntStateOf(0)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        prefs = AppearanceStore.load(this)
        val current = BrowserSites.current(intent)
        setContent {
            BrowserTheme(prefs) {
                Box(Modifier.fillMaxSize().background(Aioa.colors.background).systemBarsPadding()) {
                    SitesPage(current, tick, ::finish) { record ->
                        Browser.open(this@BrowserSitesActivity, "https://${record.host}")
                        finish()
                    }
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        prefs = AppearanceStore.load(this)
        tick++
    }
}
