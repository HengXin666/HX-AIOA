package com.hengxin.aioa.ui

import com.hengxin.aioa.ui.groupinfo.GsPage
import com.hengxin.aioa.ui.groupinfo.GsStack
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** 返回路径的约定; 新加一处跨栏跳转时, 在这里补一条它的 "进去 → 返回" 用例。 */
class TabNavTest {
    private fun path(vararg steps: (TabNav) -> TabNav): TabNav = steps.fold(TabNav()) { n, s -> s(n) }

    @Test
    fun 启动在总览_返回交给系统() {
        assertFalse(TabNav().canBack)
    }

    @Test
    fun 点底部栏_返回回总览() {
        val n = path({ it.select(Tab.ME) })
        assertTrue(n.canBack)
        assertEquals(TabNav(Tab.OVERVIEW), n.back())
    }

    @Test
    fun 我的跳工作台_返回回我的() {
        val n = path({ it.select(Tab.ME) }, { it.go(Tab.RESOURCES) })
        assertEquals(Tab.ME, n.back().tab)
        assertEquals(Tab.OVERVIEW, n.back().back().tab)
    }

    @Test
    fun 消息横幅从资源进群_退出群后回资源() {
        val n = path({ it.select(Tab.RESOURCES) }, { it.go(Tab.CHAT) })
        assertEquals(Tab.RESOURCES, n.back().tab)
    }

    @Test
    fun 总览卡片跳走_返回回总览且不再有路径() {
        val n = path({ it.go(Tab.AGENT) }).back()
        assertEquals(TabNav(Tab.OVERVIEW), n)
        assertFalse(n.canBack)
    }

    @Test
    fun 连跳两层_逐级返回() {
        val n = path({ it.select(Tab.ME) }, { it.go(Tab.RESOURCES) }, { it.go(Tab.CHAT) })
        assertEquals(listOf(Tab.RESOURCES, Tab.ME, Tab.OVERVIEW), generateSequence(n.back()) { if (it.tab == Tab.OVERVIEW) null else it.back() }.map { it.tab }.toList())
    }

    @Test
    fun 跳回路径上的栏_截断不绕圈() {
        val n = path({ it.select(Tab.ME) }, { it.go(Tab.RESOURCES) }, { it.go(Tab.ME) })
        assertEquals(TabNav(Tab.ME), n)
    }

    @Test
    fun 跳到当前栏_不记路径() {
        val n = path({ it.select(Tab.CHAT) }, { it.go(Tab.CHAT) })
        assertEquals(TabNav(Tab.CHAT), n)
    }

    @Test
    fun 换栏清空路径() {
        val n = path({ it.select(Tab.ME) }, { it.go(Tab.RESOURCES) }, { it.select(Tab.AGENT) })
        assertEquals(TabNav(Tab.AGENT), n)
    }

    // 新外壳 (#121): 侧栏进 "我的" 或某个群是 go, 返回回到打开侧栏时所在的栏
    @Test
    fun 侧栏进我的_返回原栏() {
        val n = path({ it.select(Tab.RESOURCES) }, { it.go(Tab.ME) })
        assertEquals(TabNav(Tab.RESOURCES), n.back())
    }

    @Test
    fun 侧栏进最近会话_返回原栏() {
        val n = path({ it.select(Tab.AGENT) }, { it.go(Tab.CHAT) })
        assertEquals(TabNav(Tab.AGENT), n.back())
    }

    // 群聊设置的子页 (#137): 成员 → Agent 设置逐级返回, 退到根交给外层 (群会话)
    @Test
    fun 群设置子页_逐级返回到根() {
        val s = GsStack().push(GsPage.Members()).push(GsPage.Agent("k1"))
        assertEquals(GsPage.Agent("k1"), s.top)
        assertEquals(GsPage.Members(), s.pop().top)
        assertFalse(s.pop().pop().canBack)
    }

    @Test
    fun 群设置重复点同一子页_不叠两层() {
        val s = GsStack().push(GsPage.Search).push(GsPage.Search)
        assertEquals(1, s.pages.size)
    }

    // 会话页 v2 (#136): 资料卡 "发消息" 打开单聊仍在消息栏, 不多记一层, 返回还是回原来的栏
    @Test
    fun 资料卡开单聊_返回原栏() {
        val n = path({ it.select(Tab.AGENT) }, { it.go(Tab.CHAT) }, { it.go(Tab.CHAT) })
        assertEquals(TabNav(Tab.AGENT), n.back())
    }
}
