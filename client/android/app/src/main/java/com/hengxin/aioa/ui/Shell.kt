package com.hengxin.aioa.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
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
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.Constants
import com.hengxin.aioa.config.AppearancePrefs
import com.hengxin.aioa.kit.AioaColors
import com.hengxin.aioa.kit.AppScaffold
import com.hengxin.aioa.kit.NavItem
import com.hengxin.aioa.ui.settings.MeDeps
import com.hengxin.aioa.ui.settings.MeHost
import com.hengxin.aioa.ui.settings.SettingsPage
import kotlinx.coroutines.flow.first

enum class Tab(val label: String, val icon: String) {
    OVERVIEW("总览", "gauge"),
    CHAT("消息", "message-circle"),
    // 一级栏叫 "工作区" (#139), 任务本身仍叫 agent harness
    AGENT("工作区", Constants.ICON_ACTIVITY),
    // 资源页就是服务器页 (#139): 顶部只留一个 "服务器"
    RESOURCES("服务器", "server"),
    ME("我的", "user"),
}

// GitHub 叠层里的 "选择仓库" 页, 不会与 owner/repo 冲突
private const val GH_PICK = "#pick"
// 手机宽度上限, 与组件库 Adaptive 的 Compact 一致
private val COMPACT_MAX = 600.dp

private val NAV = Tab.entries.map { NavItem(it.name, it.label, it.icon) }

/** 主界面: 手机底部五栏, 平板左侧导航; 返回键先退子页, 再回跳过来的那一栏 (没有就回总览), 最后退出。 */
@Composable
fun Shell(chat: ChatModel, settings: () -> SettingsModel, actions: SystemActions, prefs: AppearancePrefs, setPrefs: (AppearancePrefs) -> Unit, onNotes: () -> Unit) {
    // 当前栏与跨栏跳转的返回路径, 规则见 TabNav; 改栏只走 nav.select / go / back
    var nav by rememberSaveable(stateSaver = TabNav.saver) { mutableStateOf(TabNav()) }
    val tab = nav.tab
    // 邀请链接拉起 App: 切到消息页弹出加入框
    androidx.compose.runtime.LaunchedEffect(chat.groups.pendingInvite) { if (chat.groups.pendingInvite != null) nav = nav.go(Tab.CHAT) }
    // 从 GitHub 空状态跳来时直接进数据源页
    var meStart by rememberSaveable { mutableStateOf(SettingsPage.ROOT) }
    // 从 GitHub 页跳进 "我的" 子页时为 true; 子页返回时回到来源栏并重新叠上 GitHub 页, 而不是 "我的" 列表
    var meFromGithub by rememberSaveable { mutableStateOf(false) }
    // GitHub 页叠在当前栏之上: null 不显示, 空串是列表, owner/repo 是详情; 返回逐级回到打开它的那一栏
    var github by rememberSaveable { mutableStateOf<String?>(null) }
    val openGithub = { github = "" }
    // GitHub 插件被停用: 正开着的 GitHub 页一起关掉
    androidx.compose.runtime.LaunchedEffect(chat.github.enabled) { if (!chat.github.enabled) github = null }
    // 工作台里点待办: 跳到消息栏的原消息
    androidx.compose.runtime.LaunchedEffect(chat.groups.focusTick) { if (chat.groups.focusTick > 0) { github = null; nav = nav.go(Tab.CHAT) } }
    BackHandler(enabled = nav.canBack) { nav = nav.back() }
    // 当前看板进程重建后还在 (#139): 看板状态在 ViewModel 里, 进程被回收会丢, 这里存一份
    var savedBoard by rememberSaveable { mutableStateOf(chat.spaces.board) }
    androidx.compose.runtime.LaunchedEffect(Unit) {
        if (chat.spaces.board != savedBoard) chat.spaces.board = savedBoard
        androidx.compose.runtime.snapshotFlow { chat.spaces.board }.collect { savedBoard = it }
    }
    // 从侧栏进 "收藏" 或 "最近会话" (#139, docs/client/android/navigation.md): 退出那一页就直接回来源栏, 不用再按一次
    var sideReturn by rememberSaveable { mutableStateOf(false) }
    androidx.compose.runtime.LaunchedEffect(sideReturn, tab) {
        if (!sideReturn) return@LaunchedEffect
        if (tab != Tab.CHAT) { sideReturn = false; return@LaunchedEffect }
        androidx.compose.runtime.snapshotFlow { chat.groups.open == null && !chat.groups.favoritesOpen }.first { it }
        sideReturn = false
        nav = nav.back()
    }
    // 从别的栏经侧栏跳进消息栏的子页才记; 本来就在消息栏时, 退出回群列表就是来源
    val fromSide: (() -> Unit) -> Unit = { open -> sideReturn = tab != Tab.CHAT; open(); nav = nav.go(Tab.CHAT) }
    // 平板才用侧边导航; 按最短边判断, 手机横屏仍是新外壳, 转屏不换整套导航 (#139)
    val phoneShell = prefs.newShell && androidx.compose.ui.platform.LocalConfiguration.current.smallestScreenWidthDp < COMPACT_MAX.value
    val pages = androidx.compose.runtime.saveable.rememberSaveableStateHolder()
    androidx.compose.runtime.CompositionLocalProvider(LocalPageStates provides pages) {
    Box {
        val select: (Tab) -> Unit = { t -> github = null; meStart = SettingsPage.ROOT; meFromGithub = false; sideReturn = false; nav = nav.select(t) }
        val page: @Composable () -> Unit = {
            val gh = github
            if (gh != null) KeepState("gh:$gh") {
                if (gh == GH_PICK) {
                    GithubPickPage(chat.github) { github = "" }
                } else if (gh.isEmpty()) {
                    GithubPage(chat.github, { github = null }, { github = it }, { github = GH_PICK }) {
                        github = null
                        chat.sources.startAdd(Constants.SOURCE_GITHUB)
                        meFromGithub = true
                        meStart = SettingsPage.SOURCES
                        nav = nav.go(Tab.ME)
                    }
                } else GithubRepoPage(chat.github, gh) { github = "" }
            }
            if (gh == null) {
            KeepState("tab:${tab.name}") {
            when (tab) {
                Tab.OVERVIEW -> OverviewPage(chat, openGithub) { nav = nav.go(it) }
                Tab.CHAT -> ChatScreen(chat)
                Tab.AGENT -> AgentPage(chat)
                Tab.RESOURCES -> MetricsPage(chat)
                // "我的" 的子页自己处理返回键, 逐级回到列表
                Tab.ME -> MeHost(MeDeps(chat, settings, actions, prefs, setPrefs, onNotes) { nav = nav.go(Tab.RESOURCES) }, meStart, if (meFromGithub) {
                    {
                        meFromGithub = false
                        meStart = SettingsPage.ROOT
                        nav = nav.back()
                        github = ""
                    }
                } else null, if (phoneShell) ({ nav = nav.back() }) else null)
            }
            }
            }
        }
        // 子页 (群里, 收藏, GitHub, 我的) 自带顶栏, 这时不叠外壳的顶栏与标签
        val atRoot = github == null && tab != Tab.ME && (tab != Tab.CHAT || (chat.groups.open == null && !chat.groups.favoritesOpen))
        BoxWithConstraints(Modifier.safeDrawingPadding()) {
            if (phoneShell) {
                HomeFrame(
                    tab, atRoot, chat, select, { nav = nav.go(it) }, { fromSide { chat.groups.favoritesOpen = true } },
                    openGithub, { key -> fromSide { chat.groups.openGroup(key) } }, { key, seq -> fromSide { chat.groups.openAt(key, seq) } },
                    prefs.mode, { setPrefs(prefs.copy(mode = it)) }, page,
                )
            } else {
                // 宽屏没有新外壳的看板返回: 在开发 / 服务器 / 插件看板按返回先回日常, 不直接退出 App (#139)
                BackHandler(enabled = tab == Tab.OVERVIEW && github == null && chat.spaces.board != BOARD_DAILY) { chat.spaces.board = BOARD_DAILY }
                AppScaffold(NAV, tab.name, { key -> select(Tab.valueOf(key)) }) { page() }
            }
        }
        MessageBanner(chat) {
            github = null
            nav = nav.go(Tab.CHAT)
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
