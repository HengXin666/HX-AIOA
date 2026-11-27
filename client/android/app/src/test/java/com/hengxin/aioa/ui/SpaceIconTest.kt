package com.hengxin.aioa.ui

import com.hengxin.aioa.kit.IconRef
import com.hengxin.aioa.kit.Space
import com.hengxin.aioa.kit.SpaceLayout
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** 空间自选图标 (#142): 覆盖规则, 图标搜索, SVG 光栅化里不碰安卓的部分 (颜色, 单色判断, transform, viewBox)。 */
class SpaceIconTest {
    @Test
    fun 内置页面与插件空间都用自选图标_插件没选时用声明的() {
        val todo = Space("todo", "点子待办", icon = "lightbulb", origin = "hengxin666.todo")
        val mine = Space("hx", "HX", icon = "server", origin = "a.b", layout = SpaceLayout(icon = "img:0123456789abcdef01234567"))
        val tabs = homeTabs(listOf(todo, mine), 0, icons = mapOf(Tab.CHAT.name to "mail", BOARD_DAILY to "svg:abcdef0123456789abcdef01"))
        val icon = tabs.associate { it.id to it.icon }
        assertEquals("svg:abcdef0123456789abcdef01", icon[BOARD_DAILY])
        assertEquals("mail", icon[Tab.CHAT.name])
        assertEquals(Tab.AGENT.icon, icon[Tab.AGENT.name])
        assertEquals("lightbulb", icon["todo"])
        assertEquals("img:0123456789abcdef01234567", icon["hx"])
    }

    @Test
    fun 上传图标引用() {
        assertTrue(IconRef.isCustom("img:abc"))
        assertTrue(IconRef.isCustom("svg:abc"))
        assertFalse(IconRef.isCustom("server"))
        assertEquals("abc", IconRef.imageId("svg:abc"))
        assertNull(IconRef.imageId("server"))
    }

    @Test
    fun 图标搜索_英文名与中文关键词() {
        val names = listOf("server", "terminal", "mail", "lightbulb")
        assertEquals(names, searchIcons(names, " "))
        assertEquals(listOf("server"), searchIcons(names, "SERV"))
        assertEquals(listOf("server"), searchIcons(names, "服务器"))
        assertEquals(listOf("lightbulb"), searchIcons(names, "点子"))
        assertEquals(emptyList(), searchIcons(names, "不存在"))
    }

    @Test
    fun svg颜色与单色判断() {
        assertEquals(0xFF000000.toInt(), svgColor("currentColor"))
        assertEquals(0xFFFF0000.toInt(), svgColor("#f00"))
        assertEquals(0xFF112233.toInt(), svgColor("#112233"))
        assertEquals(0xFF0A141E.toInt(), svgColor("rgb(10, 20, 30)"))
        assertNull(svgColor("none"))
        assertTrue(svgMono("currentColor"))
        assertTrue(svgMono("#000"))
        assertTrue(svgMono("none"))
        assertFalse(svgMono("#ff0000"))
    }

    @Test
    fun svg的transform与viewBox() {
        assertEquals(listOf(1f, 0f, 0f, 1f, 3f, 4f), svgTransform("translate(3 4)").toList())
        // 先平移后缩放: 2 * (x + 3)
        assertEquals(listOf(2f, 0f, 0f, 2f, 6f, 8f), svgTransform("scale(2) translate(3,4)").toList())
        assertEquals(listOf(0f, 0f, 24f, 24f), svgViewBox(null, null, null).toList())
        assertEquals(listOf(0f, 0f, 16f, 32f), svgViewBox(null, "16px", "32").toList())
        assertEquals(listOf(-1f, 2f, 48f, 48f), svgViewBox("-1 2 48 48", "10", "10").toList())
    }
}
