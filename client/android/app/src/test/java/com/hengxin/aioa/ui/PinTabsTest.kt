package com.hengxin.aioa.ui

import com.hengxin.aioa.kit.HomeSpace
import kotlin.test.Test
import kotlin.test.assertEquals

/** 顶部标签置顶上限 (#139, home-spaces §2 §3)。 */
class PinTabsTest {
    private fun tab(id: String, plugin: Boolean = false) = HomeSpace(id, id, "x", plugin = if (plugin) id else null)
    private val tabs = listOf(tab("ov"), tab("chat"), tab("agent"), tab("dev"), tab("res"), tab("todo", true), tab("hxoa", true))
    private fun shown(pins: Map<String, Boolean> = emptyMap(), hidden: Set<String> = emptySet()) =
        pinTabs(tabs, pins, hidden).filter { it.pinned }.map { it.id }

    @Test
    fun 默认_内置置顶_插件不置顶() {
        assertEquals(listOf("ov", "chat", "agent", "dev", "res"), shown())
    }

    @Test
    fun 最多5个_超出的就算设过也不进标签() {
        assertEquals(listOf("ov", "chat", "agent", "dev", "res"), shown(mapOf("todo" to true)))
        assertEquals(listOf("ov", "chat", "dev", "res", "todo"), shown(mapOf("agent" to false, "todo" to true)))
    }

    @Test
    fun 总览总是置顶_隐藏的不置顶() {
        assertEquals(listOf("ov", "chat", "agent", "dev", "res"), shown(mapOf("ov" to false)))
        assertEquals(listOf("ov", "chat", "dev", "res"), shown(mapOf("agent" to false, "todo" to true), hidden = setOf("todo")))
    }
}
