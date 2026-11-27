package com.hengxin.aioa.link

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LinkStatsHistoryTest {
    private fun s(at: Long, vararg c: Int) = LinkStatsHistory.Snap(at, c.toList())

    @Test fun spreadsDeltasIntoBuckets() {
        val snaps = listOf(s(0, 1, 0), s(10, 4, 1), s(25, 6, 1), s(35, 2, 3))
        assertArrayEquals(intArrayOf(0, 3, 2, 2), LinkStatsHistory.spread(snaps, 0, 0, 40, 4))
        assertArrayEquals(intArrayOf(0, 1, 0, 2), LinkStatsHistory.spread(snaps, 1, 0, 40, 4))
    }

    @Test fun parseSnap() {
        assertEquals(s(5, 1, 2), LinkStatsHistory.parse("5 1 2"))
        assertNull(LinkStatsHistory.parse("x 1"))
    }
}
