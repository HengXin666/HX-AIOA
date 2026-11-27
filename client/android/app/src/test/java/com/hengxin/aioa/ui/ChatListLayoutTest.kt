package com.hengxin.aioa.ui

import com.hengxin.aioa.proto.ServerFrame
import com.hengxin.aioa.ui.chat.ChatMeta
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** 消息列表 v2 (#135) 的排列: 置顶折叠, 域是一行, 筛选时不分域。 */
class ChatListLayoutTest {
    private fun row(key: String, ts: Long, pinned: Boolean = false, unread: Int = 0, muted: Boolean = false) = GroupRowData(
        key,
        ChatMeta(key, key, null, pinned, muted, 0, null, emptyList(), 0),
        ServerFrame.Msg(ts, ts, "x", "hi", null, key),
        unread,
    )

    @Test
    fun 置顶超过三个折叠() {
        val rows = (1..5).map { row("p$it", it.toLong(), pinned = true) } + row("a", 10)
        val out = layoutList(rows, emptyList(), ListFilter(), pinsOpen = false)
        assertEquals(listOf("g:p5", "g:p4", "g:p3", "fold", "g:a"), out.map { it.key })
        assertEquals(2, (out[3] as ListEntry.Fold).hidden)
        assertEquals(7, layoutList(rows, emptyList(), ListFilter(), pinsOpen = true).size)
    }

    @Test
    fun 域是一行_按最近时间与会话混排_未读不算免打扰() {
        val rows = listOf(row("a", 5), row("b", 9, unread = 2), row("c", 7, unread = 4, muted = true), row("d", 1))
        val out = layoutList(rows, listOf(ChatFolder("开发", listOf("b", "c"))), ListFilter(), pinsOpen = false)
        assertEquals(listOf("d:开发", "g:a", "g:d"), out.map { it.key })
        assertEquals(2, (out[0] as ListEntry.Domain).unread)
    }

    @Test
    fun 筛选时不分域() {
        val rows = listOf(row("a", 5), row("b", 9, unread = 1))
        val folders = listOf(ChatFolder("开发", listOf("b")))
        assertEquals(listOf("g:b"), layoutList(rows, folders, ListFilter(unread = true), false).map { it.key })
        assertEquals(listOf("g:b", "g:a"), layoutList(rows, folders, ListFilter(setOf("a", "b")), false).map { it.key })
        assertTrue(layoutList(rows, folders, ListFilter(emptySet()), false).isEmpty())
    }

    @Test
    fun 未读筛选与计数同口径_免打扰不算() {
        val rows = listOf(row("a", 5, unread = 3, muted = true), row("b", 9, unread = 1))
        assertEquals(listOf("g:b"), layoutList(rows, emptyList(), ListFilter(unread = true), false).map { it.key })
        assertEquals(1, unreadCount(rows))
    }

    @Test
    fun 域里置顶的群只出现一次_点进域仍列出() {
        val rows = listOf(row("a", 5, pinned = true, unread = 2), row("b", 9, unread = 1))
        val folders = listOf(ChatFolder("开发", listOf("a", "b")))
        val out = layoutList(rows, folders, ListFilter(), false)
        assertEquals(listOf("g:a", "d:开发"), out.map { it.key })
        assertEquals(listOf("b"), (out[1] as ListEntry.Domain).rows.map { it.key })
        assertEquals(1, (out[1] as ListEntry.Domain).unread)
        assertEquals(listOf("a", "b"), domainRows(rows, folders[0]).map { it.key })
    }
}
