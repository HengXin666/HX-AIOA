package com.hengxin.aioa.ui

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** 仓库历史 (#134): 往前翻时按 id 去重, 没有 next 或整页重复算到头。 */
class GithubHistoryTest {
    private fun item(id: String) = GhHistItem(id, 0, id, null, null, null, null)

    @Test
    fun 翻页去重_没有next就到头() {
        val a = mergeHistory(GhHistList(loading = true), GhHistPage(listOf(item("a"), item("b")), "100"))
        assertEquals(listOf("a", "b"), a.items.map { it.id })
        assertFalse(a.done)
        assertFalse(a.loading)
        val b = mergeHistory(a, GhHistPage(listOf(item("b"), item("c")), null))
        assertEquals(listOf("a", "b", "c"), b.items.map { it.id })
        assertTrue(b.done)
    }

    @Test
    fun 整页都重复也算到头_免得一直翻() {
        val a = mergeHistory(GhHistList(), GhHistPage(listOf(item("a")), "1"))
        assertTrue(mergeHistory(a, GhHistPage(listOf(item("a")), "2")).done)
    }
}
