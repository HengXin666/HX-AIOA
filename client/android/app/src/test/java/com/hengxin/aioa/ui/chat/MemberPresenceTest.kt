package com.hengxin.aioa.ui.chat

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class MemberPresenceTest {
    private val now = 1_700_000_000_000L
    private val minute = 60_000L
    private val p = MemberPresence(setOf("u_a"), mapOf("u_a" to 1L, "u_b" to now - 5 * minute, "u_c" to now - 3 * 60 * minute))

    @Test
    fun label() {
        assertEquals("在线", p.label("u_a", now))
        assertEquals("5 分钟前在线", p.label("u_b", now))
        assertEquals("3 小时前在线", p.label("u_c", now))
        assertNull(p.label("u_x", now))
        assertTrue(p.isOnline("u_a"))
    }

    @Test
    fun joined() {
        assertNull(joinedDay(0))
        assertTrue(Regex("\\d{4}-\\d{2}-\\d{2}").matches(joinedDay(1_700_000_000_000L).orEmpty()))
    }
}
