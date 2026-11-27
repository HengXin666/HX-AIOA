package com.hengxin.aioa.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.config.ConfigStore
import com.hengxin.aioa.config.ThemeMode
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.DropMenu
import com.hengxin.aioa.kit.HomeShell
import com.hengxin.aioa.kit.HomeSidebar
import com.hengxin.aioa.kit.HomeSpace
import com.hengxin.aioa.kit.HomeTopBar
import com.hengxin.aioa.kit.MenuEntry
import com.hengxin.aioa.kit.SideAccount
import com.hengxin.aioa.kit.SideLink
import com.hengxin.aioa.kit.SideRecent
import com.hengxin.aioa.kit.SpaceSwitcher
import com.hengxin.aioa.kit.SpaceTabs
import com.hengxin.aioa.kit.rememberHomeShellState
import com.hengxin.aioa.ui.chat.plainPreview
import kotlinx.coroutines.launch

// 新外壳 (#121, 设置 → 外观 → 预览 打开): 左侧栏推开, 顶栏 + 顶部标签, 无底栏。页面本身沿用现有实现
private const val RECENTS = 5
private const val KEY_FAV = "#fav"
private const val KEY_GITHUB = "#github"
private const val KEY_THEME = "#theme"
private const val KEY_JOIN = "#join"
private const val RECENT_PREFIX = "g:"
private val BAR_OFFSET = 52.dp

private val TABS = listOf(Tab.OVERVIEW, Tab.CHAT, Tab.AGENT, Tab.RESOURCES)

@Composable
fun HomeFrame(
    tab: Tab,
    bars: Boolean,
    chat: ChatModel,
    onTab: (Tab) -> Unit,
    onGo: (Tab) -> Unit,
    onFavorites: () -> Unit,
    onGithub: () -> Unit,
    onOpenGroup: (String) -> Unit,
    setMode: (ThemeMode) -> Unit,
    content: @Composable () -> Unit,
) {
    val shell = rememberHomeShellState()
    val scope = rememberCoroutineScope()
    var menu by remember { mutableStateOf(false) }
    var switcher by remember { mutableStateOf(false) }
    val g = chat.groups
    val rows by remember { derivedStateOf { g.rows() } }
    val unread by remember { derivedStateOf { rows.sumOf { if (it.muted) 0 else it.unread } } }
    val spaces = TABS.map { HomeSpace(it.name, it.label, it.icon, badge = if (it == Tab.CHAT) unread else 0) }
    val context = LocalContext.current
    val server = remember { ConfigStore.load(context)?.server?.substringAfter("://")?.trimEnd('/').orEmpty() }
    val dark = Aioa.tokens.dark
    val close: () -> Unit = { scope.launch { shell.close() } }
    val pick: (String) -> Unit = { key ->
        when {
            key.startsWith(RECENT_PREFIX) -> onOpenGroup(key.removePrefix(RECENT_PREFIX))
            key == KEY_FAV -> onFavorites()
            key == KEY_GITHUB -> onGithub()
            key == KEY_THEME -> setMode(if (dark) ThemeMode.LIGHT else ThemeMode.DARK)
            key == KEY_JOIN -> { g.pendingInvite = ""; onGo(Tab.CHAT) }
            key == Tab.ME.name -> onGo(Tab.ME)
            Tab.entries.any { it.name == key } -> onTab(Tab.valueOf(key))
        }
        close()
    }
    BackHandler(enabled = shell.isOpen) { close() }
    val barPx = with(LocalDensity.current) { BAR_OFFSET.roundToPx() }
    HomeShell(shell, sidebar = {
        val recents = rows.sortedByDescending { it.order }.take(RECENTS).map { r ->
            val title = r.meta?.title?.takeIf { it.isNotBlank() } ?: r.key
            SideRecent(RECENT_PREFIX + r.key, title, r.last?.text?.let(::plainPreview).orEmpty(), title.take(1), r.unread)
        }
        HomeSidebar(
            SideAccount(if (chat.online) "已连接" else "未连接", server, chat.online),
            listOf(SideLink(KEY_FAV, "收藏", "star"), SideLink(KEY_GITHUB, "GitHub", "github")),
            spaces,
            recents,
            listOf(SideLink(KEY_THEME, if (dark) "浅色" else "深色", if (dark) "sun" else "moon"), SideLink(Tab.ME.name, "我的", "user")),
            tab.name,
            onSelect = pick,
            onEditSpaces = {},
            onAccount = { pick(Tab.ME.name) },
        )
    }) {
        Column(Modifier.fillMaxSize()) {
            if (bars) {
                HomeTopBar(tab.label, switcher, { scope.launch { shell.open() } }, { switcher = !switcher }, menu, { menu = !menu }, dot = unread > 0)
                SpaceTabs(spaces, tab.name, { onTab(Tab.valueOf(it)) })
            }
            Box(Modifier.weight(1f).fillMaxWidth()) { content() }
        }
        DropMenu(
            menu,
            listOf(
                MenuEntry(KEY_JOIN, "加入群聊", "scan-line"),
                MenuEntry(KEY_FAV, "收藏", "star"),
                MenuEntry(KEY_THEME, if (dark) "切到浅色" else "切到深色", if (dark) "sun" else "moon", divider = true),
                MenuEntry(Tab.ME.name, "我的与设置", "settings"),
            ),
            { menu = false; pick(it.key) },
            { menu = false },
            offset = IntOffset(0, barPx),
        )
        SpaceSwitcher(switcher, spaces, tab.name, { switcher = false; pick(it) }, { switcher = false }, { switcher = false }, IntOffset(0, barPx))
    }
}
