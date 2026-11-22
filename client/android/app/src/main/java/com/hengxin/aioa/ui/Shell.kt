package com.hengxin.aioa.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.hengxin.aioa.Constants
import com.hengxin.aioa.config.AppearancePrefs
import com.hengxin.aioa.kit.AioaColors
import com.hengxin.aioa.kit.AppScaffold
import com.hengxin.aioa.kit.NavItem

enum class Tab(val label: String, val icon: String) {
    OVERVIEW("总览", "gauge"),
    CHAT("消息", "message-circle"),
    AGENT("Agent", Constants.ICON_ACTIVITY),
    RESOURCES("资源", "server"),
    ME("我的", "user"),
}

private val NAV = Tab.entries.map { NavItem(it.name, it.label, it.icon) }

/** 主界面: 手机底部五栏, 平板左侧导航; 返回键先回总览再退出。 */
@Composable
fun Shell(chat: ChatModel, prefs: AppearancePrefs, setPrefs: (AppearancePrefs) -> Unit, onNotes: () -> Unit, onSettings: () -> Unit) {
    var tab by rememberSaveable { mutableStateOf(Tab.OVERVIEW) }
    BackHandler(enabled = tab != Tab.OVERVIEW) { tab = Tab.OVERVIEW }
    AppScaffold(NAV, tab.name, { key -> tab = Tab.valueOf(key) }, Modifier.safeDrawingPadding()) {
        when (tab) {
            Tab.OVERVIEW -> OverviewPage(chat) { tab = it }
            Tab.CHAT -> ChatScreen(chat)
            Tab.AGENT -> AgentPage(chat)
            Tab.RESOURCES -> MetricsPage(chat.metrics)
            Tab.ME -> MePage(prefs, setPrefs, onNotes, onSettings)
        }
    }
}

/** 让 Material 组件 (聊天, 设置页) 跟组件库同一套颜色。 */
fun materialScheme(c: AioaColors, dark: Boolean): ColorScheme {
    val base = if (dark) darkColorScheme() else lightColorScheme()
    return base.copy(
        primary = c.accent,
        onPrimary = c.onAccent,
        background = c.background,
        onBackground = c.text,
        surface = c.background,
        onSurface = c.text,
        surfaceVariant = c.surface,
        onSurfaceVariant = c.textSecondary,
        surfaceContainer = c.surface,
        surfaceContainerHigh = c.surfaceAlt,
        outline = c.textSecondary,
        outlineVariant = c.border,
        error = c.danger,
    )
}
