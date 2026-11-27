package com.hengxin.aioa.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.systemGestureExclusion
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
private const val KEY_NEW_GROUP = "#new-group"
private const val KEY_EDIT_SPACE = "#edit-space"
private const val RECENT_PREFIX = "g:"
private val BAR_OFFSET = 52.dp
private const val MORE_SPACES = "#more"
private const val KEY_SEARCH = "#search"
// 左缘排除的宽与高: 系统每条边最多认 200dp 高
private val EDGE_WIDTH = 32.dp
private val EDGE_HEIGHT = 200.dp

/** 左缘要排除系统返回手势的一段: 宽 32dp, 高 200dp, 竖直居中 (拇指最常划的位置)。 */
internal fun edgeBand(width: Float, height: Float, density: androidx.compose.ui.unit.Density): androidx.compose.ui.geometry.Rect = with(density) {
    val h = minOf(EDGE_HEIGHT.toPx(), height)
    val top = (height - h) / 2
    androidx.compose.ui.geometry.Rect(0f, top, minOf(EDGE_WIDTH.toPx(), width), top + h)
}

/** 外壳顶栏是否正显示页名: 为 true 时页面自己的大标题不再画。 */
val LocalShellBar = androidx.compose.runtime.staticCompositionLocalOf { false }

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
    onOpenAt: (String, Long) -> Unit,
    mode: ThemeMode,
    setMode: (ThemeMode) -> Unit,
    content: @Composable () -> Unit,
) {
    val shell = rememberHomeShellState()
    val scope = rememberCoroutineScope()
    var menu by remember { mutableStateOf(false) }
    var switcher by remember { mutableStateOf(false) }
    var managing by remember { mutableStateOf(false) }
    var searching by remember { mutableStateOf(false) }
    val g = chat.groups
    val rows by remember { derivedStateOf { g.rows() } }
    val unread by remember { derivedStateOf { rows.sumOf { if (it.muted) 0 else it.unread } } }
    // 一级页面: 总览, 消息, 开发, 服务器, 插件空间, agent harness, 资源; 顶部标签与侧栏 "空间" 列同一份 (#121)
    // 置顶最多 5 个 (#139): 标签只放置顶的, 其余在侧栏 "更多空间" 与标题下的切换里
    val spaces = homeTabs(chat.spaces.spaces, unread, chat.spaces.tabOrder, pins = chat.spaces.pins())
    val selected = homeSelected(tab, chat.spaces.board, chat.spaces.spaces)
    val board: (String) -> Unit = { key ->
        chat.spaces.board = key
        if (tab != Tab.OVERVIEW) onTab(Tab.OVERVIEW)
    }
    val context = LocalContext.current
    // 换服务端要重连, 连接状态一变就重读 (#139: 以前没带 key, 换了服务端侧栏还是旧地址)
    val server = remember(chat.online) { ConfigStore.load(context)?.server?.substringAfter("://")?.trimEnd('/').orEmpty() }
    // 侧栏账号头用我的头像与昵称 (#139): 本机记过就直接用, 没有时连上后问一次 /me
    var myAvatar by remember { mutableStateOf(com.hengxin.aioa.data.Me.avatar) }
    androidx.compose.runtime.LaunchedEffect(chat.online) {
        if (!chat.online || myAvatar != null) return@LaunchedEffect
        val r = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { com.hengxin.aioa.net.Api.call(context, "GET", listOf(com.hengxin.aioa.Constants.ME_PATH)) }
        r.body?.optJSONObject("user")?.optString("avatar")?.ifEmpty { null }?.let {
            com.hengxin.aioa.data.Me.setAvatar(context, it)
            myAvatar = it
        }
    }
    // 主题三态循环 (#139): 跟随系统 → 浅色 → 深色 → 跟随系统, 不会把 "跟随系统" 覆盖掉
    val nextMode = when (mode) {
        ThemeMode.SYSTEM -> ThemeMode.LIGHT
        ThemeMode.LIGHT -> ThemeMode.DARK
        ThemeMode.DARK -> ThemeMode.SYSTEM
    }
    val modeIcon = when (mode) {
        ThemeMode.SYSTEM -> "monitor"
        ThemeMode.LIGHT -> "sun"
        ThemeMode.DARK -> "moon"
    }
    val close: () -> Unit = { scope.launch { shell.close() } }
    // 编辑空间 (#139): 自建 / 插件空间进入区块编辑 (排序, 尺寸); 内置看板没有可编辑的区块, 先弹出空间切换选一个
    val editSpaces: () -> Unit = {
        val current = chat.spaces.spaces.firstOrNull { it.id == chat.spaces.board }
        if (current != null) {
            if (tab != Tab.OVERVIEW) onTab(Tab.OVERVIEW)
            chat.spaces.editing = true
        } else switcher = true
    }
    val pick: (String) -> Unit = { key ->
        when {
            key.startsWith(RECENT_PREFIX) -> onOpenGroup(key.removePrefix(RECENT_PREFIX))
            key == KEY_FAV -> onFavorites()
            key == KEY_GITHUB -> onGithub()
            key == KEY_THEME -> setMode(nextMode)
            key == KEY_SEARCH -> searching = true
            key == KEY_JOIN -> { g.pendingInvite = ""; onGo(Tab.CHAT) }
            key == KEY_NEW_GROUP -> { if (g.open != null) g.close(); g.pendingNewGroup = true; onGo(Tab.CHAT) }
            key == KEY_EDIT_SPACE -> editSpaces()
            key == Tab.ME.name -> onGo(Tab.ME)
            Tab.entries.any { it.name == key } -> onTab(Tab.valueOf(key))
            spaces.any { it.id == key } -> board(key)
            // 侧栏 "更多空间": 没置顶的都在标题下的空间切换里
            key == MORE_SPACES -> switcher = true
        }
        close()
    }
    // 开发 / 服务器 / 插件空间也是一级页面: 返回先回总览, 和别的标签一致
    BackHandler(enabled = bars && tab == Tab.OVERVIEW && selected != BOARD_DAILY) { chat.spaces.board = BOARD_DAILY }
    // 后登记的先收到返回键: 侧栏开着时先关侧栏
    BackHandler(enabled = shell.isOpen) { close() }
    val density = LocalDensity.current
    val barPx = with(density) { BAR_OFFSET.roundToPx() }
    // 侧栏只在一级页面能划出 (#121); 进群, 群设置, GitHub, 我的等子页里划不动
    // 拖开侧栏的手势在左缘和系统返回手势抢 (#139): 一级页面把左缘一段排除掉, 左缘右划是拉侧栏而不是退出 App
    val edge = if (bars) Modifier.systemGestureExclusion { r -> edgeBand(r.size.width.toFloat(), r.size.height.toFloat(), density) } else Modifier
    HomeShell(shell, modifier = edge, gestures = bars, sidebar = {
        val recents = rows.sortedByDescending { it.order }.take(RECENTS).map { r ->
            val title = r.meta?.title?.takeIf { it.isNotBlank() } ?: r.key
            SideRecent(RECENT_PREFIX + r.key, title, r.last?.text?.let(::plainPreview).orEmpty(), title.take(1), r.unread)
        }
        HomeSidebar(
            SideAccount(com.hengxin.aioa.data.Me.label, server, chat.online, avatar = myAvatar?.let { id -> { com.hengxin.aioa.ui.chat.ChatAvatar(com.hengxin.aioa.data.Me.uid ?: com.hengxin.aioa.data.Me.label, id, 40.dp) } }),
            // GitHub 入口跟着 GitHub 插件 (hengxin666.github) 是否启用 (#139), 停用了不再点进空页
            listOfNotNull(SideLink(KEY_FAV, "收藏", "star"), SideLink(KEY_GITHUB, "GitHub", "github").takeIf { chat.github.enabled }),
            spaces,
            recents,
            listOf(SideLink(KEY_THEME, mode.label, modeIcon), SideLink(Tab.ME.name, "我的", "user")),
            selected,
            onSelect = pick,
            onEditSpaces = { close(); managing = true },
            onAccount = { pick(Tab.ME.name) },
            onSearch = { pick(KEY_SEARCH) },
        )
    }) {
        Column(Modifier.fillMaxSize()) {
            if (bars) {
                val title = if (tab == Tab.OVERVIEW) boardTitle(chat.spaces.board, chat.spaces.spaces) else tab.label
                HomeTopBar(title, switcher, { scope.launch { shell.open() } }, { switcher = !switcher }, menu, { menu = !menu }, dot = unread > 0)
                SpaceTabs(spaces.filter { it.pinned }, selected, pick)
            }
            Box(Modifier.weight(1f).fillMaxWidth()) {
                androidx.compose.runtime.CompositionLocalProvider(LocalShellBar provides bars) { content() }
            }
        }
        DropMenu(
            menu,
            listOf(
                // 右上菜单只放动作 (#139, home-spaces §4): 新建, 加入, 编辑空间; 收藏与我的在侧栏
                MenuEntry(KEY_NEW_GROUP, "新建群聊", "message-square-plus"),
                MenuEntry(KEY_JOIN, "加入群聊", "user-plus"),
                MenuEntry(KEY_EDIT_SPACE, "编辑这个空间", "sliders-horizontal"),
                MenuEntry(KEY_THEME, "外观", modeIcon, hint = mode.label, divider = true),
                MenuEntry(Tab.ME.name, "我的与设置", "settings"),
            ),
            { menu = false; pick(it.key) },
            { menu = false },
            offset = IntOffset(0, barPx),
        )
        // 标题下的空间切换 (#138): 全部一级页面 (含没置顶的), 侧栏 "更多空间" 也打开它
        SpaceSwitcher(switcher, spaces, selected, { key ->
            switcher = false
            pick(key)
        }, { switcher = false; managing = true }, { switcher = false }, IntOffset(0, barPx))
        // 管理空间与排序 (#139): 以前内置看板上点了没反应
        if (managing) SpaceManageSheet(chat.spaces, unread) { managing = false }
        if (searching) HomeSearchPage(chat, { searching = false; onOpenGroup(it) }, { k, seq -> searching = false; onOpenAt(k, seq) }) { searching = false }
    }
}
