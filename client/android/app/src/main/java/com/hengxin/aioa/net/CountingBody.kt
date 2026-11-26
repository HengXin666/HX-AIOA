package com.hengxin.aioa.net

import okhttp3.MediaType
import okhttp3.RequestBody
import okio.Buffer
import okio.BufferedSink
import okio.ForwardingSink
import okio.buffer

/**
 * 给请求体计数: 写出时回报 (已发字节, 总字节)。
 * 每次 writeTo 都从 0 报起, 重试 (OkHttp 自己重发或调用方再次执行) 时进度自然重置。
 */
class CountingBody(private val inner: RequestBody, private val onProgress: (sent: Long, total: Long) -> Unit) : RequestBody() {
    override fun contentType(): MediaType? = inner.contentType()

    override fun contentLength(): Long = inner.contentLength()

    override fun isOneShot(): Boolean = inner.isOneShot()

    override fun writeTo(sink: BufferedSink) {
        val total = contentLength()
        onProgress(0, total)
        val counting = object : ForwardingSink(sink) {
            private var sent = 0L

            // 上游可能一次交来整个请求体, 拆成小块写, 进度才跟得上网络
            override fun write(source: Buffer, byteCount: Long) {
                var left = byteCount
                while (left > 0) {
                    val n = minOf(left, STEP_BYTES)
                    super.write(source, n)
                    sent += n
                    left -= n
                    onProgress(sent, total)
                }
            }
        }
        val out = counting.buffer()
        inner.writeTo(out)
        out.flush()
    }

    private companion object {
        const val STEP_BYTES = 4L * 1024
    }
}
