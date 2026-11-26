package com.hengxin.aioa.ui.todo

import com.hengxin.aioa.kit.TodoRow
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** 待办看板的分组, 倒计时, 提醒键 (#105)。 */
class TodoModelTest {
    private val hour = 3_600_000L
    private val day = 24 * hour
    private fun row(id: String, area: String? = null, repo: String? = null, due: Long? = null, remind: Int? = null, star: Boolean = false, state: String = TodoRow.STATE_OPEN) =
        TodoRow(id, id, null, state, 2, null, 0, created = 1, repo = repo, channel = "plugin-todo", area = area, due = due, remind = remind, star = star)

    @Test
    fun 分区_没填时关联仓库的算开发_其余未分区() {
        val secs = sections(listOf(row("a", area = "生活"), row("b", repo = "o/r"), row("c")), TodoAxis.AREA)
        assertEquals(listOf("生活", "开发", "未分区"), secs.map { it.title })
        // 按分区看时, 没有仓库的那组不画组头
        assertEquals("", secs[0].groups.single().title)
    }

    @Test
    fun 截止分桶_逾期在前_无截止最后() {
        val now = System.currentTimeMillis()
        val secs = sections(listOf(row("x"), row("late", due = now - hour), row("far", due = now + 30 * day)), TodoAxis.DUE)
        assertEquals(listOf("已逾期", "以后", "无截止"), secs.map { it.title })
    }

    @Test
    fun 倒计时与逾期() {
        assertEquals("还剩 2 天 3 小时" to false, countdown(1_000_000 + 2 * day + 3 * hour, 1_000_000))
        assertEquals("还剩 40 分钟" to true, countdown(1_000_000 + 40 * 60_000, 1_000_000))
        assertEquals("逾期 1 天" to true, countdown(1_000_000, 1_000_000 + day))
    }

    @Test
    fun 提醒键与服务端去重键一致_完成的不提醒() {
        val due = 10 * day
        val plan = alarmPlan(row("t-1", due = due, remind = 15))!!
        assertEquals("todo:plugin-todo:t-1:${due - 15 * 60_000}", plan.key)
        assertNull(alarmPlan(row("t-2", due = due, remind = 15, state = TodoRow.STATE_DONE)))
        assertNull(alarmPlan(row("t-3", due = due)))
    }

    @Test
    fun 重点_星标与快到期() {
        val now = System.currentTimeMillis()
        val f = focusRows(listOf(row("s", star = true), row("soon", due = now + hour), row("later", due = now + 3 * day), row("x")), now)
        assertEquals(listOf("soon", "s"), f.map { it.id })
        assertEquals("每月", everyText("month", 1))
        assertEquals("每 2 周", everyText("week", 2))
        assertTrue(newTodoId().startsWith("m-"))
    }
}
