package com.hengxin.aioa.ui.settings

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DebugChartsTest {
    @Test fun parsesRequestLine() {
        assertEquals(HttpLine("GET", "/api/v1/chats", "200", 123), parseHttp("12:00:01 GET /api/v1/chats 200 123ms"))
        assertEquals("api.github.com (外部, 不记路径)", parseHttp("12:00:01 GET api.github.com (外部, 不记路径) SocketTimeoutException 10000ms")?.path)
        assertNull(parseHttp("garbage"))
    }

    @Test fun classes() {
        assertEquals(2, codeClass("204"))
        assertEquals(1, codeClass("101"))
        assertEquals(0, codeClass("IOException"))
    }
}
