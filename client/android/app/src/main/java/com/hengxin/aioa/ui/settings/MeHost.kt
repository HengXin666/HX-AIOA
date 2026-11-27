package com.hengxin.aioa.ui.settings

import com.hengxin.aioa.ui.KeepState
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
import androidx.compose.ui.platform.LocalContext
import com.hengxin.aioa.config.Auth
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

/**
 * "我的" 导航: 手机单栏, 子页从右滑入; 宽屏左列表右详情。
 * 返回: 从别的栏直接跳进来的子页 (onLeave 不为空), 返回回到来源; 其余子页回到列表。
 * 宽屏列表一直在, 返回不再把右侧换成 "关于" (看起来像没反应), 交给外层 (回总览或退出)。
 */
@Composable
fun MeHost(deps: MeDeps, initial: SettingsPage = SettingsPage.ROOT, onLeave: (() -> Unit)? = null, onRootBack: (() -> Unit)? = null) {
    var page by rememberSaveable(initial) { mutableStateOf(initial) }
    val entered = onLeave != null && initial != SettingsPage.ROOT
    val back: () -> Unit = { if (entered && page == initial) onLeave?.invoke() else page = SettingsPage.ROOT }
    val chat = deps.chat
    val summary = MeSummary(
        online = chat.online,
        sources = chat.sources.items.size.takeIf { chat.sources.loaded },
        spaces = chat.spaces.spaces.size,
        mode = deps.prefs.mode,
    )
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val wide = maxWidth >= TWO_PANE_MIN
        BackHandler(enabled = if (wide) entered && page == initial else page != SettingsPage.ROOT, onBack = back)
        if (wide) {
            // 宽屏默认展示 "关于", 不创建 SettingsModel
            val detail = if (page == SettingsPage.ROOT) SettingsPage.ABOUT else page
            Row(Modifier.fillMaxSize()) {
                Box(Modifier.width(LIST_PANE).fillMaxHeight()) { KeepState("me:root") { MeRoot(summary, detail, { page = it }, deps.openWorkspace) } }
                Box(Modifier.width(1.dp).fillMaxHeight().background(Aioa.colors.border))
                Box(Modifier.weight(1f).fillMaxHeight()) {
                    Crossfade(detail, animationSpec = tween(FADE_MS)) { KeepState("me:${it.name}") { Detail(it, deps, if (entered && it == initial) back else null, back) } }
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
                KeepState("me:${p.name}") {
                    if (p == SettingsPage.ROOT) MeRoot(summary, null, { page = it }, deps.openWorkspace, onRootBack) else Detail(p, deps, back, back)
                }
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
        SettingsPage.PLUGINS -> PluginsPage(onBack) { chat.groups.openAt(it, 0) }
        SettingsPage.ACCOUNT -> AccountPage(deps.settings(), saved, onBack)
        SettingsPage.MEMBERS -> MembersPage(onBack)
        SettingsPage.SERVER -> ServerPage(deps.settings(), chat.online, saved, onBack)
        SettingsPage.PROXY -> ProxyPage(deps.settings(), saved, onBack)
        SettingsPage.LINK_LOG -> LinkLogPage(deps.settings(), onBack)
        SettingsPage.NOTIFY -> NotifyPage(deps.actions, onBack)
        SettingsPage.APPEARANCE -> AppearancePage(deps.prefs, deps.setPrefs, onBack)
        SettingsPage.SYSTEM -> SystemPage(deps.actions, onBack)
        SettingsPage.CF_USAGE -> CfUsagePage(onBack)
        SettingsPage.SENDERS -> SystemSendersPage(chat.groups.directory, onBack)
        SettingsPage.STORAGE -> StoragePage(Auth.load(LocalContext.current)?.role == ROLE_OWNER, onBack)
        SettingsPage.UPDATE -> UpdatePage(deps.settings(), deps.onNotes, onBack)
        SettingsPage.ABOUT -> AboutPage(onBack)
    }
}
