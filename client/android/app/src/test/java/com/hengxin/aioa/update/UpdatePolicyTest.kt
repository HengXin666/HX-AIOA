package com.hengxin.aioa.update

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class UpdatePolicyTest {
    private val hour = 60 * 60_000L

    @Test
    fun tagToVersion() {
        assertEquals(148L, UpdatePolicy.tagVersion("android-148"))
        assertNull(UpdatePolicy.tagVersion("server-3"))
        assertNull(UpdatePolicy.tagVersion("android-x"))
        assertNull(UpdatePolicy.tagVersion(null))
    }

    @Test
    fun newerOnlyWhenGreater() {
        assertTrue(UpdatePolicy.isNewer(10, 9))
        assertFalse(UpdatePolicy.isNewer(9, 9))
        assertFalse(UpdatePolicy.isNewer(8, 9))
        assertFalse(UpdatePolicy.isNewer(null, 9))
    }

    @Test
    fun checkInterval() {
        val now = 100 * hour
        assertTrue(UpdatePolicy.checkDue(now, 0, 6 * hour))
        assertFalse(UpdatePolicy.checkDue(now, now - 5 * hour, 6 * hour))
        assertTrue(UpdatePolicy.checkDue(now, now - 6 * hour, 6 * hour))
        assertTrue(UpdatePolicy.checkDue(now, now + hour, 6 * hour))
    }

    @Test
    fun networkCondition() {
        assertTrue(UpdatePolicy.canDownload(AutoDownload.WIFI, NetKind.UNMETERED))
        assertFalse(UpdatePolicy.canDownload(AutoDownload.WIFI, NetKind.METERED))
        assertTrue(UpdatePolicy.canDownload(AutoDownload.ANY, NetKind.METERED))
        assertFalse(UpdatePolicy.canDownload(AutoDownload.ANY, NetKind.NONE))
        assertFalse(UpdatePolicy.canDownload(AutoDownload.OFF, NetKind.UNMETERED))
        assertEquals(AutoDownload.WIFI, AutoDownload.of("bogus"))
        assertEquals(AutoDownload.OFF, AutoDownload.of("off"))
    }
}
