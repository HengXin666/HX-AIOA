package com.hengxin.aioa.ui

import com.hengxin.aioa.kit.HomeSpace
import com.hengxin.aioa.kit.Space

// 总览的看板: 日常 / 开发 / 服务器 / 插件空间 (#138); 新外壳是顶部标签与侧栏 "空间", 旧外壳在总览顶上的小 Chip 里选
const val BOARD_DAILY = "#daily"
const val BOARD_DEV = "#dev"
const val BOARD_SERVERS = "#servers"
val BOARDS = listOf(BOARD_DAILY to "日常", BOARD_DEV to "开发", BOARD_SERVERS to "服务器")
private const val OVERVIEW_TITLE = "总览"
private const val SPACE_ICON = "layout-dashboard"

/** 插件 / Agent 下发的空间 (点子待办, HX OA...), 用户藏起来的不列。 */
fun pluginSpaces(spaces: List<Space>): List<HomeSpace> =
    spaces.filter { !it.layout.hidden }.map { HomeSpace(it.id, it.title, it.icon ?: SPACE_ICON, plugin = it.origin ?: it.id) }

/** 标题下的空间切换: 总览 (日常), 开发, 服务器, 再接插件空间。 */
fun boardSpaces(spaces: List<Space>): List<HomeSpace> = listOf(
    HomeSpace(BOARD_DAILY, OVERVIEW_TITLE, "gauge"),
    HomeSpace(BOARD_DEV, "开发", "code-xml"),
    HomeSpace(BOARD_SERVERS, "服务器", "server"),
) + pluginSpaces(spaces)

/**
 * 新外壳的一级页面 (顶部标签与侧栏 "空间" 同一份, #139): 总览, 消息, 工作区, 开发, 服务器, 各插件空间。
 * "服务器" 直接是完整的资源页 (原来的服务器看板与资源页重叠); 看板类的 id 是看板 key, 其余是 [Tab] 名。
 */
fun homeTabs(
    spaces: List<Space>,
    unread: Int,
    order: List<String> = emptyList(),
    withHidden: Boolean = false,
    pins: Map<String, Boolean> = emptyMap(),
): List<HomeSpace> {
    val boards = boardSpaces(spaces)
    val tab = { t: Tab -> HomeSpace(t.name, t.label, t.icon) }
    val plugins = if (withHidden) spaces.map { HomeSpace(it.id, it.title, it.icon ?: SPACE_ICON, plugin = it.origin ?: it.id) } else pluginSpaces(spaces)
    val all = listOf(boards[0], HomeSpace(Tab.CHAT.name, Tab.CHAT.label, Tab.CHAT.icon, badge = unread), tab(Tab.AGENT)) +
        boards.filter { it.id == BOARD_DEV } + tab(Tab.RESOURCES) + plugins
    val hidden = spaces.filter { it.layout.hidden }.map { it.id }.toSet()
    return pinTabs(ordered(all, order), pins, hidden)
}

/** 顶部标签最多置顶这么多个 (#139, home-spaces §2), 其余在侧栏 "更多空间" 与标题下的切换里。 */
const val MAX_PINNED = 5

/**
 * 按顺序标出哪些置顶 (#139): 总览永远置顶; 设过的按设的, 没设过的内置页面置顶, 插件空间不置顶 (home-spaces §3 规则 1);
 * 隐藏的不置顶; 置顶的数到 [MAX_PINNED] 为止, 再往后的就算设过也先不进标签。
 */
fun pinTabs(tabs: List<HomeSpace>, pins: Map<String, Boolean>, hidden: Set<String> = emptySet()): List<HomeSpace> {
    var n = 0
    return tabs.mapIndexed { i, s ->
        val want = i == 0 || (s.id !in hidden && (pins[s.id] ?: (s.plugin == null)))
        val on = want && n < MAX_PINNED
        if (on) n++
        s.copy(pinned = on)
    }
}

/** 按用户排过的顺序 (#139): 总览永远第一, 排过的按那个顺序, 新出现的接在后面保持默认顺序。 */
fun ordered(all: List<HomeSpace>, order: List<String>): List<HomeSpace> {
    if (order.isEmpty()) return all
    val rank = order.withIndex().associate { (i, id) -> id to i }
    val head = all.take(1)
    return head + all.drop(1).withIndex().sortedWith(compareBy({ rank[it.value.id] ?: Int.MAX_VALUE }, { it.index })).map { it.value }
}

/** 当前选中的一级页面 id: 总览下是看板 (看板没了回日常), 其余是栏名。 */
fun homeSelected(tab: Tab, board: String, spaces: List<Space>): String = when {
    tab != Tab.OVERVIEW -> tab.name
    boardSpaces(spaces).any { it.id == board } -> board
    else -> BOARD_DAILY
}

/** 顶栏标题: 日常看板叫 "总览", 其它用看板名; 看板没了 (插件停用) 回到总览。 */
fun boardTitle(board: String, spaces: List<Space>): String =
    boardSpaces(spaces).firstOrNull { it.id == board }?.title ?: OVERVIEW_TITLE
