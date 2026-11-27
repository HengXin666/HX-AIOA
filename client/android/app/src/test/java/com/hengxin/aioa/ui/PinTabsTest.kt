package com.hengxin.aioa.ui

import com.hengxin.aioa.kit.HomeSpace
import com.hengxin.aioa.kit.Space
import com.hengxin.aioa.kit.SpaceLayout
import kotlin.test.Test
import kotlin.test.assertEquals

/** 顶部标签置顶 (#139, home-spaces §2 §3): 用户设过的优先, 没设过的按优先级补空位, 最多 5 个。 */
class PinTabsTest {
    private val ov = BOARD_DAILY
    private val chat = Tab.CHAT.name
    private val agent = Tab.AGENT.name
    private val dev = BOARD_DEV
    private val res = Tab.RESOURCES.name

    private fun builtin(id: String) = HomeSpace(id, id, "x")
    private fun plugin(id: String, tab: String? = null) = HomeSpace(id, id, "x", plugin = id, tab = tab)
    private val base = listOf(builtin(ov), builtin(chat), builtin(agent), builtin(dev), builtin(res))

    private fun shown(
        tabs: List<HomeSpace>,
        pins: Map<String, Boolean> = emptyMap(),
        hidden: Set<String> = emptySet(),
    ) = pinTabs(tabs, pins, hidden).filter { it.pinned }.map { it.id }

    @Test
    fun 默认_点子待办primary挤掉服务器_显示顺序不变() {
        val tabs = base + plugin("todo", TAB_PRIMARY)
        assertEquals(listOf(ov, chat, agent, dev, "todo"), shown(tabs))
    }

    @Test
    fun 默认_真实空间列表_总览消息点子待办工作区开发() {
        val spaces = listOf(Space("todo", "点子待办", origin = "hengxin666.todo", tab = TAB_PRIMARY), Space("hxoa", "HX OA"))
        val tabs = homeTabs(spaces, 0)
        assertEquals(listOf(ov, chat, agent, dev, "todo"), tabs.filter { it.pinned }.map { it.id })
        assertEquals(listOf(res, "hxoa"), tabs.filter { !it.pinned }.map { it.id })
    }

    @Test
    fun auto插件排在内置页之后_有空位才补() {
        assertEquals(listOf(ov, chat, agent, dev, res), shown(base + plugin("a") + plugin("b", "auto")))
        // 关掉两个内置, 空位按列表顺序给 auto 插件
        assertEquals(listOf(ov, chat, dev, "a", "b"), shown(base + plugin("a") + plugin("b", "auto"), mapOf(agent to false, res to false)))
    }

    @Test
    fun none插件从不自动置顶_手动可以() {
        val tabs = base + plugin("n", TAB_NONE)
        assertEquals(listOf(ov, chat, agent, dev), shown(tabs, mapOf(res to false)))
        assertEquals(listOf(ov, chat, agent, dev, "n"), shown(tabs, mapOf("n" to true)))
    }

    @Test
    fun primary之间按列表顺序_优先于其它内置页() {
        val tabs = base + plugin("p1", TAB_PRIMARY) + plugin("p2", TAB_PRIMARY)
        assertEquals(listOf(ov, chat, agent, "p1", "p2"), shown(tabs))
    }

    @Test
    fun 显式true先占名额_按显示顺序_超出的进更多() {
        val tabs = base + plugin("todo", TAB_PRIMARY) + plugin("a") + plugin("b")
        assertEquals(listOf(ov, chat, res, "a", "b"), shown(tabs, mapOf("a" to true, "b" to true, res to true)))
        // 五个都是用户置顶的: 再设 true 的也进不来
        val firm = mapOf(chat to true, agent to true, dev to true, res to true, "a" to true)
        assertEquals(listOf(ov, chat, agent, dev, res), shown(tabs, firm))
    }

    @Test
    fun 显式false永远不置顶_即使有空位() {
        val tabs = base + plugin("todo", TAB_PRIMARY)
        assertEquals(listOf(ov, agent, dev, res), shown(tabs, mapOf(chat to false, "todo" to false)))
    }

    @Test
    fun 总览总是置顶() {
        assertEquals(listOf(ov, chat, agent, dev, res), shown(base, mapOf(ov to false)))
    }

    @Test
    fun 隐藏的不置顶_显式true也不行() {
        val tabs = base + plugin("todo", TAB_PRIMARY) + plugin("a")
        assertEquals(listOf(ov, chat, agent, dev, res), shown(tabs, mapOf("a" to true), hidden = setOf("todo", "a")))
    }

    @Test
    fun 用户排过序_名额仍按优先级与默认顺序分_显示按用户顺序() {
        val all = base + plugin("todo", TAB_PRIMARY)
        val tabs = ordered(all, listOf("todo", res, dev, agent, chat))
        val out = pinTabs(tabs, emptyMap(), base = all)
        assertEquals(listOf(ov, "todo", dev, agent, chat), out.filter { it.pinned }.map { it.id })
    }

    @Test
    fun 管理抽屉的状态_置顶自动更多() {
        val tabs = pinTabs(base + plugin("todo", TAB_PRIMARY), mapOf(dev to true))
        val pins = mapOf(dev to true)
        assertEquals(
            listOf(PinState.PINNED, PinState.AUTO, PinState.AUTO, PinState.PINNED, PinState.MORE, PinState.AUTO),
            tabs.mapIndexed { i, t -> pinState(t, i == 0, pins) },
        )
    }

    @Test
    fun 插件空间的置顶来自state_pinned() {
        val spaces = listOf(Space("todo", "点子待办", origin = "hengxin666.todo", tab = TAB_PRIMARY, layout = SpaceLayout(pinned = false)))
        val tabs = homeTabs(spaces, 0, pins = mapOf("todo" to false))
        assertEquals(listOf(ov, chat, agent, dev, res), tabs.filter { it.pinned }.map { it.id })
    }
}
