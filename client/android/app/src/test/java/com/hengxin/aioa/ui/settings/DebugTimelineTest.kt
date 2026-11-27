package com.hengxin.aioa.ui.settings

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalDateTime
import java.time.ZoneId

class DebugTimelineTest {
    private val zone = ZoneId.of("Asia/Shanghai")

    @Test fun lanes() {
        assertEquals(Lane.LINK, laneOf("已连接 [App 后台]"))
        assertEquals(Lane.DROP, laneOf("看门狗: 当前离线, 立即重连 [App 后台]"))
        assertEquals(Lane.DROP, laneOf("网络断开 [App 前台]"))
        assertEquals(Lane.WATCH, laneOf("心跳 15 分钟可用, 下次试 20 分钟"))
        assertEquals(Lane.UI, laneOf("[界面] 已连接"))
        assertNull(laneOf("[界面] 开始连接 (direct, v1)"))
        assertEquals(Lane.CORE, laneOf("后台服务启动"))
        assertNull(laneOf("收到 Msg"))
    }

    @Test fun timeWithoutYear() {
        val now = LocalDateTime.of(2027, 1, 1, 0, 30).atZone(zone).toInstant().toEpochMilli()
        val exp = LocalDateTime.of(2026, 12, 31, 23, 59, 58).atZone(zone).toInstant().toEpochMilli()
        assertEquals(exp, linkTime("12-31 23:59:58 已连接", now, zone))
        assertNull(linkTime("bad", now, zone))
    }
}
