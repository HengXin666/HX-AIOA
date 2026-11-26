package com.hengxin.aioa.net

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import okio.Buffer
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class CountingBodyTest {
    private val data = ByteArray(SIZE) { (it % 251).toByte() }
    private val body = data.toRequestBody("image/webp".toMediaType())

    @Test
    fun reportsSentBytesUpToTotal() {
        val seen = mutableListOf<Pair<Long, Long>>()
        val counting = CountingBody(body) { sent, total -> seen += sent to total }
        val out = Buffer()
        counting.writeTo(out)
        assertContentEquals(data, out.readByteArray())
        assertEquals(SIZE.toLong(), counting.contentLength())
        assertEquals(0L to SIZE.toLong(), seen.first())
        assertEquals(SIZE.toLong() to SIZE.toLong(), seen.last())
        assertTrue(seen.all { it.second == SIZE.toLong() })
        assertTrue(seen.zipWithNext().all { (a, b) -> b.first >= a.first }, "进度应单调不减")
        // 60KB 一次交给 sink 也要拆成多次回报, 界面才有中间进度
        assertTrue(seen.size > MIN_REPORTS, "回报次数太少: ${seen.size}")
    }

    @Test
    fun retryStartsFromZero() {
        val seen = mutableListOf<Long>()
        val counting = CountingBody(body) { sent, _ -> seen += sent }
        counting.writeTo(Buffer())
        val firstRun = seen.size
        counting.writeTo(Buffer())
        assertEquals(0L, seen[firstRun])
        assertEquals(SIZE.toLong(), seen.last())
    }

    private companion object {
        const val SIZE = 60 * 1024 + 123
        const val MIN_REPORTS = 10
    }
}
