package com.hengxin.aioa.ui.drive

import com.hengxin.aioa.ui.BOARD_DRIVE
import com.hengxin.aioa.ui.homeTabs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class DriveModelTest {
    private fun node(name: String, dir: Boolean = false, size: Long = 0, at: Long = 0, mime: String = "") = DriveNode(name, name, dir, size, mime, at)

    @Test
    fun 路径_拼接_上一级_去掉点段() {
        assertEquals("/a", DrivePaths.join("/", "a"))
        assertEquals("/a/b", DrivePaths.join("/a", "b"))
        assertEquals("/", DrivePaths.parent("/a"))
        assertEquals("/a", DrivePaths.parent("/a/b"))
        assertEquals("/", DrivePaths.parent("/"))
        assertEquals("/a/b", DrivePaths.normalize("//a/./../b/"))
    }

    @Test
    fun 面包屑_从根到当前() {
        assertEquals(listOf("网盘" to "/", "照片" to "/照片", "2026" to "/照片/2026"), DrivePaths.crumbs("/照片/2026", "网盘"))
        assertEquals(listOf("网盘" to "/"), DrivePaths.crumbs("/", "网盘"))
    }

    @Test
    fun 名字校验() {
        assertTrue(DrivePaths.validName("报告 v2.pdf"))
        assertFalse(DrivePaths.validName("a/b"))
        assertFalse(DrivePaths.validName(".."))
        assertFalse(DrivePaths.validName(" a"))
        assertFalse(DrivePaths.validName(""))
    }

    @Test
    fun 附件目录只读() {
        assertTrue(DrivePaths.readonly("/aioa", whole = true))
        assertTrue(DrivePaths.readonly("/aioa/2026-11/f_1_a.png", whole = true))
        assertFalse(DrivePaths.readonly("/aioa/备份", whole = true))
        assertTrue(DrivePaths.readonly("/2026-11", whole = false))
        assertFalse(DrivePaths.readonly("/照片", whole = false))
    }

    @Test
    fun 大小格式() {
        assertEquals("0 B", sizeText(0))
        assertEquals("1023 B", sizeText(1023))
        assertEquals("1.5 KB", sizeText(1536))
        assertEquals("12.0 MB", sizeText(12L * 1024 * 1024))
        assertEquals("1.50 GB", sizeText(1536L * 1024 * 1024))
    }

    @Test
    fun 排序_文件夹在前_名字按自然顺序() {
        val list = listOf(node("b10.txt"), node("文档", dir = true), node("b2.txt"), node("A.txt"))
        assertEquals(listOf("文档", "A.txt", "b2.txt", "b10.txt"), sortNodes(list, DriveSort()).map { it.name })
        assertEquals(listOf("文档", "b10.txt", "b2.txt", "A.txt"), sortNodes(list, DriveSort(desc = true)).map { it.name })
    }

    @Test
    fun 排序_按大小与时间() {
        val list = listOf(node("x", size = 30, at = 1), node("y", size = 10, at = 3), node("d", dir = true, size = 0, at = 2))
        assertEquals(listOf("d", "y", "x"), sortNodes(list, DriveSort(SortKey.SIZE)).map { it.name })
        assertEquals(listOf("d", "y", "x"), sortNodes(list, DriveSort(SortKey.TIME, desc = true)).map { it.name })
    }

    @Test
    fun 预览方式() {
        assertEquals(Preview.IMAGE, previewOf(node("a.png", mime = "image/png")))
        assertEquals(Preview.VIDEO, previewOf(node("a.mp4", mime = "video/mp4")))
        assertEquals(Preview.TEXT, previewOf(node("a.md", size = 10, mime = "application/octet-stream")))
        assertEquals(Preview.SYSTEM, previewOf(node("a.log", size = 10L * 1024 * 1024, mime = "text/plain")))
        assertEquals(Preview.SYSTEM, previewOf(node("a.pdf", mime = "application/pdf")))
    }

    @Test
    fun 同名编号() {
        assertEquals("a (1).txt", numbered("a.txt", 1))
        assertEquals("README (2)", numbered("README", 2))
        assertEquals(".env (1)", numbered(".env", 1))
    }

    @Test
    fun 网盘空间默认不置顶_可用时才出现() {
        assertFalse(homeTabs(emptyList(), 0).any { it.id == BOARD_DRIVE })
        val tabs = homeTabs(emptyList(), 0, drive = true)
        assertFalse(tabs.first { it.id == BOARD_DRIVE }.pinned)
        assertTrue(homeTabs(emptyList(), 0, pins = mapOf(BOARD_DRIVE to true), drive = true).first { it.id == BOARD_DRIVE }.pinned)
    }
}
