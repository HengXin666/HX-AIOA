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
fun pluginSpaces(spaces: List<Space>): List<HomeSpace> = spaces.filter { !it.layout.hidden }.map(::pluginTab)

// 用户自选的图标 (#142, state.icon) 优先, 其次插件声明的
private fun pluginTab(s: Space) = HomeSpace(s.id, s.title, s.layout.icon ?: s.icon ?: SPACE_ICON, plugin = s.origin ?: s.id, tab = s.tab)

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
    // 内置页面的自选图标 (#142, 账号设置 homeTabs.icons); 插件空间的在各自 state.icon
    icons: Map<String, String> = emptyMap(),
): List<HomeSpace> {
    val boards = boardSpaces(spaces)
    val tab = { t: Tab -> HomeSpace(t.name, t.label, icons[t.name] ?: t.icon) }
    val plugins = if (withHidden) spaces.map(::pluginTab) else pluginSpaces(spaces)
    val board = { b: HomeSpace -> icons[b.id]?.let { b.copy(icon = it) } ?: b }
    val all = listOf(board(boards[0]), HomeSpace(Tab.CHAT.name, Tab.CHAT.label, icons[Tab.CHAT.name] ?: Tab.CHAT.icon, badge = unread), tab(Tab.AGENT)) +
        boards.filter { it.id == BOARD_DEV }.map(board) + tab(Tab.RESOURCES) + plugins
    val hidden = spaces.filter { it.layout.hidden }.map { it.id }.toSet()
    return pinTabs(ordered(all, order), pins, hidden, base = all)
}

/** 顶部标签最多置顶这么多个 (#139, home-spaces §2), 其余在侧栏 "更多空间" 与标题下的切换里。 */
const val MAX_PINNED = 5

/** 插件空间对顶部标签的提示 (#139, 与 protocol SPACE_TABS 一致)。 */
const val TAB_PRIMARY = "primary"
const val TAB_NONE = "none"

/**
 * 没设过置顶的页面自动补空位的优先级 (#139, home-spaces §3 规则 1), 小的先补; null 表示从不自动置顶:
 * 消息 > 插件 tab = primary > 其它内置页 (按默认顺序) > 插件 auto (缺省, 按列表顺序); tab = none 不自动。
 */
internal fun autoRank(s: HomeSpace): Int? = when {
    s.plugin != null -> when (s.tab) {
        TAB_PRIMARY -> 1
        TAB_NONE -> null
        else -> 3
    }
    s.id == Tab.CHAT.name -> 0
    else -> 2
}

/**
 * 标出哪些置顶 (#139), 显示顺序不变 ([tabs] 已按用户排序): 总览永远置顶占第 1 位;
 * 用户设过的永远按用户的, 设 true 的按显示顺序先占名额, 超过 [MAX_PINNED] 的进 "更多空间";
 * 剩下的名额给没设过的, 按 [autoRank] 与默认顺序 ([base]) 分配; 隐藏的不置顶。
 */
fun pinTabs(
    tabs: List<HomeSpace>,
    pins: Map<String, Boolean>,
    hidden: Set<String> = emptySet(),
    base: List<HomeSpace> = tabs,
): List<HomeSpace> {
    val on = LinkedHashSet<String>()
    tabs.firstOrNull()?.let { on += it.id }
    val rest = tabs.drop(1).filter { it.id !in hidden }
    for (s in rest) if (pins[s.id] == true && on.size < MAX_PINNED) on += s.id
    val pos = base.withIndex().associate { (i, s) -> s.id to i }
    rest.filter { pins[it.id] == null }
        .mapNotNull { s -> autoRank(s)?.let { r -> Triple(r, pos[s.id] ?: Int.MAX_VALUE, s.id) } }
        .sortedWith(compareBy({ it.first }, { it.second }))
        .forEach { if (on.size < MAX_PINNED) on += it.third }
    return tabs.map { it.copy(pinned = it.id in on) }
}

/** 管理抽屉里每行的状态 (#139): 用户置顶的, 自动补位的, 在 "更多空间" 的。 */
enum class PinState { PINNED, AUTO, MORE }

fun pinState(t: HomeSpace, first: Boolean, pins: Map<String, Boolean>): PinState = when {
    !t.pinned -> PinState.MORE
    first || pins[t.id] == true -> PinState.PINNED
    else -> PinState.AUTO
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
