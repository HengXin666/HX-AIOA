package com.hengxin.aioa.ui.todo

import com.hengxin.aioa.kit.ItemType
import com.hengxin.aioa.kit.Space
import com.hengxin.aioa.kit.SpaceItem
import com.hengxin.aioa.kit.SpacePanel
import com.hengxin.aioa.kit.TodoRow
import com.hengxin.aioa.ui.isTodoSpace
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** 待办父子树: 建树, 子项进度, 孤儿子项, 状态列 (#152)。 */
class TodoTreeTest {
    private val done = TodoRow.STATE_DONE
    private fun row(id: String, parent: String? = null, state: String = TodoRow.STATE_OPEN, channel: String = "plugin-todo") =
        TodoRow(id, "标题 $id", null, state, 2, null, 0, created = 1, parent = parent, channel = channel)

    // p 有 5 个子孙: a (完成), b (进行中), c (完成, 下有 c1 未完成), d
    private val all = listOf(
        row("p"), row("a", "p", done), row("b", "p", TodoRow.STATE_DOING), row("c", "p", done), row("c1", "c"), row("d", "p"),
    )

    @Test
    fun 建树_子项挂在父项下() {
        val roots = forest(all)
        assertEquals(listOf("p"), roots.map { it.row.id })
        assertEquals(setOf("a", "b", "c", "d"), roots[0].kids.map { it.row.id }.toSet())
        assertEquals(listOf("c1"), roots[0].kids.first { it.row.id == "c" }.kids.map { it.row.id })
        assertEquals(6, roots[0].size)
    }

    @Test
    fun 进度数全部子孙_藏了已完成也不变() {
        val full = forest(all)[0]
        assertEquals(2 to 5, full.done to full.total)
        // 默认藏已完成: 只显示未完成的, 进度仍按全部算 (2/5, 不是 0/3)
        val open = forest(all.filter { !it.finished }, all)
        val p = open.first { it.row.id == "p" }
        assertEquals(2 to 5, p.done to p.total)
        assertEquals(setOf("b", "d"), p.kids.map { it.row.id }.toSet())
    }

    @Test
    fun 孤儿子项_父项被筛掉时升为根并记下上级() {
        val open = forest(all.filter { !it.finished }, all)
        val c1 = open.first { it.row.id == "c1" }
        assertEquals("c", c1.above?.id)
        assertNull(open.first { it.row.id == "p" }.above)
    }

    @Test
    fun 父项不存在或成环_一条不丢() {
        val rows = listOf(row("x", "gone"), row("m", "n"), row("n", "m"))
        val roots = forest(rows)
        val ids = mutableListOf<String>()
        fun walk(n: TodoNode) { ids += n.row.id; n.kids.forEach(::walk) }
        roots.forEach(::walk)
        assertEquals(setOf("x", "m", "n"), ids.toSet())
        assertEquals(3, ids.size)
        assertNull(roots.first { it.row.id == "x" }.above)
    }

    @Test
    fun 不同群同名id不串() {
        val rows = listOf(row("p", channel = "g1"), row("k", "p", channel = "g2"))
        assertEquals(2, forest(rows).size)
    }

    @Test
    fun 状态列_子项在自己的列里当根_标出上级() {
        val cols = stateColumns(all.filter { !it.finished }, all)
        assertEquals(listOf(TodoRow.STATE_OPEN, TodoRow.STATE_DOING, TodoRow.STATE_HOLD), cols.map { it.state })
        val open = cols[0]
        val p = open.nodes.first { it.row.id == "p" }
        assertEquals(listOf("d"), p.kids.map { it.row.id })
        assertEquals(2 to 5, p.done to p.total)
        val b = cols[1].nodes.single()
        assertEquals("b" to "p", b.row.id to b.above?.id)
        assertTrue(cols[2].nodes.isEmpty())
        // 放出已完成时才有已完成列, 已放弃也算在里面
        val withDone = stateColumns(all + row("z", state = TodoRow.STATE_DROPPED), all)
        assertEquals(TodoRow.STATE_DONE, withDone.last().state)
        assertEquals(setOf("a", "c", "z"), withDone.last().nodes.map { it.row.id }.toSet())
    }

    @Test
    fun 重点待办_平铺但带进度和上级() {
        val rows = all.map { if (it.id == "b") it.copy(star = true) else if (it.id == "p") it.copy(prio = 1) else it }
        val focus = focusNodes(rows)
        val p = focus.first { it.row.id == "p" }
        assertEquals(2 to 5, p.done to p.total)
        assertTrue(p.kids.isEmpty())
        assertEquals("p", focus.first { it.row.id == "b" }.above?.id)
    }

    @Test
    fun 只放待办组件的空间整页是看板() {
        val todo = SpacePanel("todos", "待办", items = listOf(SpaceItem("l", ItemType.TODO)))
        val mixed = SpacePanel("m", "混合", items = listOf(SpaceItem("v", ItemType.VALUE)))
        assertTrue(isTodoSpace(Space("todo", "点子待办", panels = listOf(todo))))
        assertFalse(isTodoSpace(Space("x", "x", panels = listOf(todo, mixed))))
        assertFalse(isTodoSpace(Space("e", "空")))
    }
}
