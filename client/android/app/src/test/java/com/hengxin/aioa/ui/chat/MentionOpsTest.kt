package com.hengxin.aioa.ui.chat

import com.hengxin.aioa.proto.Mentions
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** @ 选择与提醒 (#131 #133) 和标签 (#135) 的纯运算。 */
class MentionOpsTest {
    private val agent = ChatAgent("k1", "oa_1", emptyList(), 0, null, 1, false, sourceId = "agent:src")
    private val members = listOf(RoomMember("me", "me", "我", ROLE_OWNER), RoomMember("u2", "xm", "小明", ROLE_MEMBER))

    private fun meta(kind: String? = null) = ChatMeta("c", "群", null, false, false, 0, null, listOf(agent), 0, role = ROLE_OWNER, members = 2, kind = kind)

    @Test
    fun 群里先全体再Agent再真人_不含自己() {
        val list = MentionOps.candidates(meta(), members, "me")
        assertEquals(listOf(Mentions.ALL, "agent:k1", "u2"), list.map { it.token })
    }

    @Test
    fun 单聊没有全体与Agent() {
        assertEquals(listOf("u2"), MentionOps.candidates(meta(KIND_DM), members, "me").map { it.token })
    }

    @Test
    fun 查询词与发送记号() {
        assertEquals("o", MentionOps.query("你好 @o"))
        assertEquals("", MentionOps.query("@"))
        assertNull(MentionOps.query("a@b c"))
        assertNull(MentionOps.query("mail a@b"))
        val picked = MentionOps.candidates(meta(), members, "me")
        assertEquals(listOf("agent:k1"), MentionOps.tokens("@oa_1 看下", picked))
    }

    @Test
    fun 被at才提醒() {
        assertTrue(Mentions.hits(listOf("u2"), "u2"))
        assertTrue(Mentions.hits(listOf(Mentions.ALL), null))
        assertFalse(Mentions.hits(listOf("agent:k1"), "u2"))
    }

    @Test
    fun 标签可以多个_整体设置() {
        val t = TagOps.assign(mapOf("工作" to listOf("a"), "家人" to listOf("b")), "a", setOf("家人", "新"))
        assertEquals(listOf("家人", "新"), TagOps.of(t, "a"))
        assertEquals(emptyList<String>(), t["工作"])
        assertNull(TagOps.add(t, "工作"))
    }
}
