package com.hengxin.aioa.ui

import androidx.compose.runtime.saveable.Saver

// 跨栏跳转最多记这么多层, 再多说明在来回绕圈, 丢掉最早的
private const val MAX_TRAIL = 8

/**
 * 底部栏导航与返回路径。
 * - select: 点底部栏, 清空返回路径 (用户自己换栏, 不该再被带回去)。
 * - go: 页面里的链接跳到别的栏 (总览卡片, 我的 → 工作台, 消息横幅, 待办定位...), 记下来源。
 * - back: 有来源回来源, 没有回总览; 总览且没有来源时交给系统 (退出)。
 * 栏内的子页 (群, 子设置页, GitHub 叠层) 各自先处理返回键, 退到栏的根页后才轮到这里。
 */
data class TabNav(val tab: Tab = Tab.OVERVIEW, val trail: List<Tab> = emptyList()) {
    val canBack: Boolean get() = tab != Tab.OVERVIEW || trail.isNotEmpty()

    fun select(to: Tab): TabNav = TabNav(to)

    fun go(to: Tab): TabNav = when (to) {
        tab -> this
        // 跳回路径上已有的栏: 截到它之前, 不会越绕越长
        in trail -> TabNav(to, trail.subList(0, trail.indexOf(to)))
        else -> TabNav(to, (trail + tab).takeLast(MAX_TRAIL))
    }

    fun back(): TabNav = trail.lastOrNull()?.let { TabNav(it, trail.dropLast(1)) } ?: TabNav(Tab.OVERVIEW)

    companion object {
        val saver: Saver<TabNav, List<String>> = Saver(
            save = { n -> listOf(n.tab.name) + n.trail.map { it.name } },
            restore = { l -> TabNav(Tab.valueOf(l.first()), l.drop(1).map(Tab::valueOf)) },
        )
    }
}
