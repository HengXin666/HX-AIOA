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
 * 新外壳的一级页面 (顶部标签与侧栏 "空间" 同一份): 总览, 消息, 开发, 服务器, 各插件空间, agent harness, 资源。
 * 看板类的 id 是看板 key, 其余是 [Tab] 名。
 */
fun homeTabs(spaces: List<Space>, unread: Int): List<HomeSpace> {
    val boards = boardSpaces(spaces)
    return listOf(boards[0], HomeSpace(Tab.CHAT.name, Tab.CHAT.label, Tab.CHAT.icon, badge = unread)) + boards.drop(1) +
        listOf(Tab.AGENT, Tab.RESOURCES).map { HomeSpace(it.name, it.label, it.icon) }
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
