package com.hengxin.aioa.ui

import com.hengxin.aioa.kit.HomeSpace
import com.hengxin.aioa.kit.Space

// 总览的看板: 日常 / 开发 / 服务器 / 插件空间 (#138); 新外壳在顶栏标题的空间切换里选, 旧外壳在总览顶上的小 Chip 里选
const val BOARD_DAILY = "#daily"
const val BOARD_DEV = "#dev"
const val BOARD_SERVERS = "#servers"
val BOARDS = listOf(BOARD_DAILY to "日常", BOARD_DEV to "开发", BOARD_SERVERS to "服务器")
private const val OVERVIEW_TITLE = "总览"
private const val SPACE_ICON = "layout-dashboard"

/** 空间切换里的条目: 总览 (日常), 开发, 服务器, 再接插件空间。 */
fun boardSpaces(spaces: List<Space>): List<HomeSpace> = listOf(
    HomeSpace(BOARD_DAILY, OVERVIEW_TITLE, "gauge"),
    HomeSpace(BOARD_DEV, "开发", "code-xml"),
    HomeSpace(BOARD_SERVERS, "服务器", "server"),
) + spaces.map { HomeSpace(it.id, it.title, it.icon ?: SPACE_ICON, plugin = it.origin) }

/** 顶栏标题: 日常看板叫 "总览", 其它用看板名; 看板没了 (插件停用) 回到总览。 */
fun boardTitle(board: String, spaces: List<Space>): String =
    boardSpaces(spaces).firstOrNull { it.id == board }?.title ?: OVERVIEW_TITLE
