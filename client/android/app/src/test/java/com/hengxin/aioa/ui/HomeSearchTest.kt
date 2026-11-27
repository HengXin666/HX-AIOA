package com.hengxin.aioa.ui

import androidx.compose.ui.unit.Density
import com.hengxin.aioa.proto.ServerFrame
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** 侧栏搜索与左缘手势排除 (#139)。 */
class HomeSearchTest {
    private fun msg(seq: Long, text: String, deleted: String? = null) = ServerFrame.Msg(seq, seq, "user:a", text, null, group = "g1", deleted = deleted)

    @Test
    fun 空关键字_没有结果() {
        val (g, m) = searchHome("  ", listOf("g1" to "日常"), listOf(msg(1, "hello")))
        assertTrue(g.isEmpty() && m.isEmpty())
    }

    @Test
    fun 群按名字或id_消息按正文_新的在前_撤回的不算() {
        val groups = listOf("ops" to "运维群", "idea" to "点子待办")
        val msgs = listOf(msg(1, "部署好了"), msg(2, "再部署一次"), msg(3, "部署", deleted = "recall"))
        val (g, m) = searchHome("部署", groups, msgs)
        assertTrue(g.isEmpty())
        assertEquals(listOf(2L, 1L), m.map { it.seq })
        assertEquals(listOf("ops"), searchHome("OPS", groups, msgs).first.map { it.first })
        assertEquals(listOf("idea"), searchHome("点子", groups, msgs).first.map { it.first })
    }

    @Test
    fun 左缘排除_宽32高200_竖直居中_矮屏不越界() {
        val d = Density(1f)
        val r = edgeBand(400f, 800f, d)
        assertEquals(0f, r.left)
        assertEquals(32f, r.right)
        assertEquals(300f, r.top)
        assertEquals(500f, r.bottom)
        val short = edgeBand(400f, 120f, d)
        assertEquals(0f, short.top)
        assertEquals(120f, short.bottom)
    }
}
