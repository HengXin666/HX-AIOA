package com.hengxin.aioa.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
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
import com.hengxin.aioa.ui.settings.MeDeps
import com.hengxin.aioa.ui.settings.MeHost
import com.hengxin.aioa.ui.settings.SettingsPage

enum class Tab(val label: String, val icon: String) {
    OVERVIEW("总览", "gauge"),
    CHAT("消息", "message-circle"),
    AGENT("Agent", Constants.ICON_ACTIVITY),
    RESOURCES("资源", "server"),
    ME("我的", "user"),
}

// GitHub 叠层里的 "选择仓库" 页, 不会与 owner/repo 冲突
private const val GH_PICK = "#pick"

private val NAV = Tab.entries.map { NavItem(it.name, it.label, it.icon) }

/** 主界面: 手机底部五栏, 平板左侧导航; 返回键先退子页, 再回总览, 最后退出。 */
@Composable
fun Shell(chat: ChatModel, settings: () -> SettingsModel, actions: SystemActions, prefs: AppearancePrefs, setPrefs: (AppearancePrefs) -> Unit, onNotes: () -> Unit) {
    var tab by rememberSaveable { mutableStateOf(Tab.OVERVIEW) }
    // 邀请链接拉起 App: 切到消息页弹出加入框
    androidx.compose.runtime.LaunchedEffect(chat.groups.pendingInvite) { if (chat.groups.pendingInvite != null) tab = Tab.CHAT }
    // 从 GitHub 空状态跳来时直接进数据源页
    var meStart by rememberSaveable { mutableStateOf(SettingsPage.ROOT) }
    // GitHub 页叠在当前栏之上: null 不显示, 空串是列表, owner/repo 是详情; 返回逐级回到打开它的那一栏
    var github by rememberSaveable { mutableStateOf<String?>(null) }
    val openGithub = { github = "" }
    BackHandler(enabled = tab != Tab.OVERVIEW) { tab = Tab.OVERVIEW }
    val pages = androidx.compose.runtime.saveable.rememberSaveableStateHolder()
    androidx.compose.runtime.CompositionLocalProvider(LocalPageStates provides pages) {
    Box {
        AppScaffold(NAV, tab.name, { key -> github = null; meStart = SettingsPage.ROOT; tab = Tab.valueOf(key) }, Modifier.safeDrawingPadding()) {
            val gh = github
            if (gh != null) KeepState("gh:$gh") {
                if (gh == GH_PICK) {
                    GithubPickPage(chat.github) { github = "" }
                } else if (gh.isEmpty()) {
                    GithubPage(chat.github, { github = null }, { github = it }, { github = GH_PICK }) {
                        github = null
                        chat.sources.startAdd(Constants.SOURCE_GITHUB)
                        meStart = SettingsPage.SOURCES
                        tab = Tab.ME
                    }
                } else GithubRepoPage(chat.github, gh) { github = "" }
            }
            if (gh != null) return@AppScaffold
            KeepState("tab:${tab.name}") {
            when (tab) {
                Tab.OVERVIEW -> OverviewPage(chat, openGithub) { tab = it }
                Tab.CHAT -> ChatScreen(chat)
                Tab.AGENT -> AgentPage(chat)
                Tab.RESOURCES -> MetricsPage(chat, openGithub)
                // "我的" 的子页自己处理返回键, 逐级回到列表
                Tab.ME -> MeHost(MeDeps(chat, settings, actions, prefs, setPrefs, onNotes) { tab = Tab.RESOURCES }, meStart)
            }
            }
        }
        MessageBanner(chat) {
            github = null
            tab = Tab.CHAT
            chat.openBanner()
        }
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
