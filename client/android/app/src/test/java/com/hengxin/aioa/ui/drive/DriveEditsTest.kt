package com.hengxin.aioa.ui.drive

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class DriveEditsTest {
    private fun node(name: String, dir: Boolean = false) = DriveNode(name, name, dir, 0, "", 0)
    private val items = listOf(node("a", true), node("b.txt"), node("c", true))

    @Test
    fun 新建改名删除移动_只改本地列表() {
        val added = DriveEdits.add(items, "新", 5)
        assertEquals(4, added.size)
        assertTrue(DriveEdits.pending(added.last()))
        assertEquals(items, DriveEdits.add(items, "a"))
        assertEquals("x.txt", DriveEdits.rename(items, "b.txt", "x.txt")[1].name)
        assertEquals(listOf("a", "c"), DriveEdits.remove(items, "b.txt").map { it.id })
        assertEquals(items, DriveEdits.move(items, "b.txt", "/d", "/d"))
        assertEquals(2, DriveEdits.move(items, "b.txt", "/d", "/a").size)
    }

    @Test
    fun 预取_只取前几个文件夹_跳过占位() {
        assertEquals(listOf("/d/a", "/d/c"), DriveEdits.prefetch("/d", items))
        assertEquals(listOf("/a"), DriveEdits.prefetch("/", DriveEdits.add(items, "新"), 1))
        val many = (1..9).map { node("f$it", true) }
        assertEquals(PREFETCH_MAX, DriveEdits.prefetch("/", many).size)
    }
}
