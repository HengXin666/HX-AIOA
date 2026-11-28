package com.hengxin.aioa.ui.drive

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class DriveSpeedTest {
    @Test
    fun 速度_滑动窗口平均() {
        val m = SpeedMeter(windowMs = 5_000)
        assertEquals(0.0, m.speed())
        m.add(0, 0)
        m.add(1_000, 1_000_000)
        m.add(2_000, 2_000_000)
        assertEquals(1_000_000.0, m.speed(), 0.1)
        // 窗口外的老样本丢掉: 6 秒后只看 1..6 秒, 前面的快速段不再拉高
        m.add(6_000, 2_500_000)
        assertEquals(1_500_000.0 / 5, m.speed(), 0.1)
        // 停住不动后速度降到 0
        m.add(12_000, 2_500_000)
        m.add(13_000, 2_500_000)
        assertEquals(0.0, m.speed(), 0.1)
    }

    @Test
    fun 剩余时间与文案() {
        assertEquals(10L, etaSec(10_000, 1_000.0))
        assertEquals(1L, etaSec(1, 1_000.0))
        assertNull(etaSec(10, 0.0))
        assertEquals("剩 5 秒", etaText(5))
        assertEquals("剩 2 分 5 秒", etaText(125))
        assertEquals("剩 1 小时 1 分", etaText(3_660))
        assertEquals("剩余时间未知", etaText(null))
        assertEquals("512 B/s", speedText(512.0))
        assertEquals("2 KB/s", speedText(2048.0))
        assertEquals("1.5 MB/s", speedText(1.5 * 1024 * 1024))
    }

    @Test
    fun 续传决策() {
        assertEquals(Resume.APPEND, resumeStep(206, 100, 1000, 0))
        assertEquals(Resume.RESTART, resumeStep(206, 0, 1000, 0))
        // 服务器不认 Range: 200 整个文件, 从头写
        assertEquals(Resume.RESTART, resumeStep(200, 500, 1000, 0))
        // 直链过期: 换链, 换够次数就失败
        assertEquals(Resume.RELINK, resumeStep(403, 100, 1000, 0))
        assertEquals(Resume.RELINK, resumeStep(410, 100, 1000, 1))
        assertEquals(Resume.FAIL, resumeStep(410, 100, 1000, 2))
        assertEquals(Resume.DONE, resumeStep(416, 1000, 1000, 0))
        assertEquals(Resume.RESTART, resumeStep(416, 400, 1000, 0))
        assertEquals(Resume.RETRY, resumeStep(503, 100, 1000, 0))
        assertEquals(Resume.RETRY, resumeStep(429, 100, 1000, 0))
        assertEquals(Resume.FAIL, resumeStep(400, 100, 1000, 0))
    }

    @Test
    fun 续传偏移与范围头() {
        assertNull(rangeHeader(0))
        assertEquals("bytes=4096-", rangeHeader(4096))
        assertEquals(300L, validOffset(300, 1000))
        assertEquals(0L, validOffset(1200, 1000))
        assertEquals(100L, rangeStart("bytes 100-199/1000"))
        assertEquals(-1L, rangeStart(null))
        assertEquals(-1L, rangeStart("bytes */1000"))
    }

    @Test
    fun 文件名冲突编号() {
        val taken = setOf("a.txt", "a (1).txt", "README")
        assertEquals("b.txt", uniqueName("b.txt") { it in taken })
        assertEquals("a (2).txt", uniqueName("a.txt") { it in taken })
        assertEquals("README (1)", uniqueName("README") { it in taken })
        assertEquals("x_y.txt", uniqueName("x/y.txt") { false })
        assertEquals("文件", uniqueName("") { false })
    }

    @Test
    fun 文本按宽松_UTF8_解码() {
        val bytes = "你好".toByteArray()
        // 截在多字节字符中间不抛错
        assertEquals("你\uFFFD", decodeLenient(bytes.copyOf(4)))
        assertEquals("你好", decodeLenient(bytes))
    }
}
