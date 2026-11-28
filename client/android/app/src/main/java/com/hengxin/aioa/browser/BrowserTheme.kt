package com.hengxin.aioa.browser

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import com.hengxin.aioa.config.AppearancePrefs
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.AioaTheme
import com.hengxin.aioa.ui.materialScheme
import com.hengxin.aioa.ui.settings.PluginTheme

/** 浏览器各页的主题: 与主界面一样用 App 的明暗设置和主题插件配色。 */
@Composable
fun BrowserTheme(prefs: AppearancePrefs, content: @Composable () -> Unit) {
    PluginTheme.load(LocalContext.current)
    val theme by PluginTheme.flow.collectAsState()
    val appearance = prefs.resolve(isSystemInDarkTheme()).copy(theme = theme)
    AioaTheme(appearance) {
        MaterialTheme(colorScheme = materialScheme(Aioa.colors, appearance.dark)) { content() }
    }
}
