package com.hengxin.aioa.ui.settings

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.config.AppearancePrefs
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.ui.ChatModel
import com.hengxin.aioa.ui.SettingsModel
import com.hengxin.aioa.ui.SourcesPage
import com.hengxin.aioa.ui.SystemActions

private const val SLIDE_MS = 240
private const val FADE_MS = 160
private const val SLIDE_PART = 4
private val TWO_PANE_MIN = 720.dp
private val LIST_PANE = 340.dp

/** "我的" 用到的全部依赖; settings 延迟取, 只有进入服务端, 代理, 日志, 更新子页才创建 (会按需拉起代理内核)。 */
class MeDeps(
    val chat: ChatModel,
    val settings: () -> SettingsModel,
    val actions: SystemActions,
    val prefs: AppearancePrefs,
    val setPrefs: (AppearancePrefs) -> Unit,
    val onNotes: () -> Unit,
    val openWorkspace: () -> Unit,
)

/** "我的" 导航: 手机单栏, 子页从右滑入, 返回键回到列表; 宽屏左列表右详情。 */
@Composable
fun MeHost(deps: MeDeps, initial: SettingsPage = SettingsPage.ROOT) {
    var page by rememberSaveable(initial) { mutableStateOf(initial) }
    val toRoot = { page = SettingsPage.ROOT }
    BackHandler(enabled = page != SettingsPage.ROOT, onBack = toRoot)
    val chat = deps.chat
    val summary = MeSummary(
        online = chat.online,
        sources = chat.sources.items.size.takeIf { chat.sources.loaded },
        spaces = chat.spaces.spaces.size,
        mode = deps.prefs.mode,
    )
    BoxWithConstraints(Modifier.fillMaxSize()) {
        if (maxWidth >= TWO_PANE_MIN) {
            // 宽屏默认展示 "关于", 不创建 SettingsModel
            val detail = if (page == SettingsPage.ROOT) SettingsPage.ABOUT else page
            Row(Modifier.fillMaxSize()) {
                Box(Modifier.width(LIST_PANE).fillMaxHeight()) { MeRoot(summary, detail, { page = it }, deps.openWorkspace) }
                Box(Modifier.width(1.dp).fillMaxHeight().background(Aioa.colors.border))
                Box(Modifier.weight(1f).fillMaxHeight()) {
                    Crossfade(detail, animationSpec = tween(FADE_MS)) { Detail(it, deps, null, toRoot) }
                }
            }
        } else {
            AnimatedContent(
                targetState = page,
                transitionSpec = {
                    val dir = if (targetState != SettingsPage.ROOT) 1 else -1
                    (slideInHorizontally(tween(SLIDE_MS)) { it * dir / SLIDE_PART } + fadeIn(tween(SLIDE_MS))) togetherWith
                        (slideOutHorizontally(tween(SLIDE_MS)) { -it * dir / SLIDE_PART } + fadeOut(tween(FADE_MS)))
                },
                label = "me",
            ) { p ->
                if (p == SettingsPage.ROOT) MeRoot(summary, null, { page = it }, deps.openWorkspace) else Detail(p, deps, toRoot, toRoot)
            }
        }
    }
}

@Composable
private fun Detail(p: SettingsPage, deps: MeDeps, onBack: (() -> Unit)?, toRoot: () -> Unit) {
    val chat = deps.chat
    val saved = { chat.onConfigSaved() }
    when (p) {
        SettingsPage.ROOT -> Unit
        SettingsPage.SOURCES -> Box(Modifier.fillMaxSize().background(Aioa.colors.background)) { SourcesPage(chat.sources, toRoot) }
        SettingsPage.INTEGRATIONS -> IntegrationsPage(toRoot)
        SettingsPage.ACCOUNT -> AccountPage(deps.settings(), saved, onBack)
        SettingsPage.MEMBERS -> MembersPage(onBack)
        SettingsPage.SERVER -> ServerPage(deps.settings(), chat.online, saved, onBack)
        SettingsPage.PROXY -> ProxyPage(deps.settings(), saved, onBack)
        SettingsPage.LINK_LOG -> LinkLogPage(deps.settings(), onBack)
        SettingsPage.NOTIFY -> NotifyPage(deps.actions, onBack)
        SettingsPage.APPEARANCE -> AppearancePage(deps.prefs, deps.setPrefs, onBack)
        SettingsPage.SYSTEM -> SystemPage(deps.actions, onBack)
        SettingsPage.CF_USAGE -> CfUsagePage(onBack)
        SettingsPage.UPDATE -> UpdatePage(deps.settings(), deps.onNotes, onBack)
        SettingsPage.ABOUT -> AboutPage(onBack)
    }
}
