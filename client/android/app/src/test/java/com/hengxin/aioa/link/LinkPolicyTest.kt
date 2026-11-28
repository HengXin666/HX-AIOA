package com.hengxin.aioa.link

import com.hengxin.aioa.Constants
import com.hengxin.aioa.link.LinkPolicy.Wake
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LinkPolicyTest {
    private val skip = Constants.LINK_KEEPALIVE_MS
    private val edge = Constants.EDGE_IDLE_MS

    @Test fun wakeSkipsWhenTrafficIsRecent() {
        assertEquals(Wake.SKIP, LinkPolicy.onWake(open = true, idleMs = 10_000, sinceConnectMs = 0, skipIdleMs = skip))
    }

    @Test fun wakeProbesBeforeEdgeLimit() {
        assertEquals(Wake.PROBE, LinkPolicy.onWake(true, skip, 0, skip))
        assertEquals(Wake.PROBE, LinkPolicy.onWake(true, edge - 1, 0, skip))
    }

    // debug 群日志里每次闹钟都读到 EOF: 空闲超过 100 秒的连接已被边缘回收, 直接重建不再等 pong
    @Test fun wakeReconnectsAfterEdgeReclaim() {
        assertEquals(Wake.RECONNECT, LinkPolicy.onWake(true, edge, 0, skip))
        assertEquals(Wake.RECONNECT, LinkPolicy.onWake(true, Constants.WATCHDOG_INTERVAL_MS, 0, skip))
    }

    @Test fun wakeWhileOffline() {
        assertEquals(Wake.WAIT, LinkPolicy.onWake(false, edge * 10, Constants.CONNECT_STALL_MS, skip))
        assertEquals(Wake.RECONNECT, LinkPolicy.onWake(false, 0, Constants.CONNECT_STALL_MS + 1, skip))
    }

    @Test fun keepAliveWaitsUntilIdle() {
        assertEquals(false to skip - 30_000, LinkPolicy.keepAlive(30_000))
    }

    @Test fun keepAlivePingsBeforeEdge() {
        assertEquals(true to skip, LinkPolicy.keepAlive(skip))
        assertEquals(true to skip, LinkPolicy.keepAlive(edge - 1))
    }

    // 深睡醒来已超过上限: 不发也不重连, 交给看门狗, 免得短暂唤醒里反复建连
    @Test fun keepAliveLeavesDeadConnectionToWatchdog() {
        assertEquals(false to skip, LinkPolicy.keepAlive(edge))
        assertEquals(false to skip, LinkPolicy.keepAlive(edge * 30))
    }

    @Test fun keepAliveIntervalStaysUnderEdge() {
        assertTrue(Constants.LINK_KEEPALIVE_MS < Constants.EDGE_IDLE_MS)
        assertTrue(Constants.WATCHDOG_INTERVAL_MS > Constants.EDGE_IDLE_MS)
    }

    @Test fun idleClosedClassifiesReclaim() {
        assertTrue(LinkPolicy.idleClosed(edge))
        assertFalse(LinkPolicy.idleClosed(edge - 1))
    }

    @Test fun replayNotifiesMissedEvents() {
        val now = 1_000_000_000L
        assertTrue(LinkPolicy.notifyReplay(since = 42, resync = false, evTs = now - 60_000, now = now, notified = 0))
    }

    @Test fun replayStaysQuietOnFirstSyncResyncOldOrFlood() {
        val now = 1_000_000_000L
        assertFalse(LinkPolicy.notifyReplay(0, false, now, now, 0))
        assertFalse(LinkPolicy.notifyReplay(42, true, now, now, 0))
        assertFalse(LinkPolicy.notifyReplay(42, false, now - Constants.REPLAY_NOTIFY_MAX_AGE_MS - 1, now, 0))
        assertFalse(LinkPolicy.notifyReplay(42, false, now, now, Constants.REPLAY_NOTIFY_MAX))
    }

    @Test fun backoffDoublesUpToForegroundCap() {
        val b = LinkPolicy.Backoff()
        val waits = (1..10).map { b.next(background = false) }
        assertEquals(Constants.RECONNECT_MIN_MS, waits.first())
        assertEquals(Constants.RECONNECT_MIN_MS * 2, waits[1])
        assertEquals(Constants.RECONNECT_MAX_MS, waits.last())
        assertTrue(waits.zipWithNext().all { (a, c) -> c >= a })
    }

    @Test fun backoffBackgroundCapIsLonger() {
        val b = LinkPolicy.Backoff()
        repeat(20) { b.next(background = true) }
        assertEquals(Constants.RECONNECT_BG_MAX_MS, b.next(true))
        // 回到前台立即收回到前台上限
        assertEquals(Constants.RECONNECT_MAX_MS, b.next(false))
    }

    @Test fun backoffResets() {
        val b = LinkPolicy.Backoff()
        repeat(5) { b.next(false) }
        b.reset()
        assertEquals(Constants.RECONNECT_MIN_MS, b.next(false))
    }
}
