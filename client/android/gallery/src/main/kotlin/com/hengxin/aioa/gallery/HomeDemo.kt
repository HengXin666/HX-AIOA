package com.hengxin.aioa.gallery

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
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
import kotlinx.coroutines.launch

// 画廊用的假数据, 结构与真实总览一致
internal val DEMO_ACCOUNT = SideAccount("Heng_Xin", "aioa.lolioa.com · 已连接", online = true)
internal val DEMO_LINKS = listOf(
    SideLink("agent", "Agent", "bot", 3),
    SideLink("res", "资源", "server"),
    SideLink("fav", "收藏", "star"),
)
internal val DEMO_TOOLS = listOf(
    SideLink("plugins", "插件", "puzzle"),
    SideLink("theme", "明暗", "moon"),
    SideLink("settings", "设置", "settings"),
)
internal val DEMO_SPACES = listOf(
    HomeSpace("overview", "总览", "gauge", "需要我 · 脉搏 · 资源", 2),
    HomeSpace("chat", "消息", "message-circle", "3 条未读", 3),
    HomeSpace("dev", "开发", "code-xml", "Agent 任务 · GitHub"),
    HomeSpace("server", "服务器", "server", "2 台在线"),
    HomeSpace("todo", "点子待办", "lightbulb", "5 条未完成", plugin = "hengxin666.idea", pinned = false),
    HomeSpace("mail", "邮件", "mail", "收件箱摘要", plugin = "hengxin666.mail", pinned = false),
    HomeSpace("hxoa", "hxoa 工作区", "terminal", "3 个工作区", plugin = "hengxin666.hxoa", pinned = false),
)
internal val DEMO_RECENTS = listOf(
    SideRecent("g1", "点子待办", "イデア: 已建 issue #121", "点", 2),
    SideRecent("g2", "GitHub 动态", "HX-AIOA: 61a9db9 已部署", "G"),
    SideRecent("g3", "DSH", "镜像已推送, 等你确认", "D", 1),
    SideRecent("g4", "福利", "Steam 冬促清单", "福"),
)
internal val DEMO_MENU = listOf(
    MenuEntry("new-group", "新建群聊", "message-square-plus"),
    MenuEntry("join", "扫码 / 加入", "scan-line"),
    MenuEntry("agent", "接入 Agent", "bot"),
    MenuEntry("edit", "编辑这个空间", "sliders-horizontal", divider = true),
    MenuEntry("idea", "记个点子", "lightbulb", hint = "点子待办", divider = true, label = "插件快捷动作"),
    MenuEntry("hxoa", "新建工作区", "terminal", hint = "hxoa"),
    MenuEntry("mail", "邮件全部已读", "mail-open", hint = "邮件"),
)

/** 新总览: 侧栏 (推开) + 顶栏空间切换 + 置顶空间横排 + 右上菜单。参数用于截图时固定状态。 */
@Composable
fun HomeDemo(start: String = "overview", drawer: Float = 0f, menu: Boolean = false, switcher: Boolean = false) {
    val shell = rememberHomeShellState(drawer)
    val scope = rememberCoroutineScope()
    var space by remember { mutableStateOf(start) }
    var menuOpen by remember { mutableStateOf(menu) }
    var switchOpen by remember { mutableStateOf(switcher) }
    val title = DEMO_SPACES.firstOrNull { it.id == space }?.title ?: "总览"
    val barPx = with(LocalDensity.current) { 52.dp.roundToPx() }
    HomeShell(shell, sidebar = {
        HomeSidebar(
            DEMO_ACCOUNT, DEMO_LINKS, DEMO_SPACES, DEMO_RECENTS, DEMO_TOOLS, space,
            onSelect = { if (DEMO_SPACES.any { s -> s.id == it }) space = it; scope.launch { shell.close() } },
            onEditSpaces = {}, onAccount = {},
        )
    }) {
        Column(Modifier.fillMaxSize()) {
            HomeTopBar(
                title, switchOpen, { scope.launch { shell.open() } }, { switchOpen = !switchOpen }, menuOpen, { menuOpen = !menuOpen },
                dot = true,
            )
            SpaceTabs(DEMO_SPACES.filter { it.pinned }, space, { space = it })
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 14.dp)) {
                when (space) {
                    "chat" -> ChatSpace()
                    "dev" -> DevSpace()
                    "server" -> ServerSpace()
                    "todo" -> TodoSpace()
                    else -> OverviewSpace()
                }
                Spacer(Modifier.height(24.dp))
            }
        }
        DropMenu(menuOpen, DEMO_MENU, { menuOpen = false }, { menuOpen = false }, offset = IntOffset(0, barPx))
        SpaceSwitcher(switchOpen, DEMO_SPACES, space, { space = it; switchOpen = false }, { switchOpen = false }, { switchOpen = false }, IntOffset(0, barPx))
    }
}
