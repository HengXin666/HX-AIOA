package com.hengxin.aioa.ui.chat

import com.hengxin.aioa.proto.Bundle
import com.hengxin.aioa.proto.BundleLine
import com.hengxin.aioa.proto.FileRef
import com.hengxin.aioa.proto.ServerFrame
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** 复制可读文本与拍照清理 (#139)。 */
class CopyTextTest {
    private fun msg(text: String, file: FileRef? = null, html: String? = null, bundle: Bundle? = null) =
        ServerFrame.Msg(1, 1, "x", text, null, "g", html = html, file = file, bundle = bundle)

    @Test
    fun 文件与合并转发复制可读文本() {
        val f = FileRef("id1", "报告.pdf", 2048, "application/pdf")
        assertEquals("[文件] 报告.pdf (2 KB)", copyText(msg("[文件] 报告.pdf", f)))
        assertTrue(copyText(msg("看这个", f)).startsWith("看这个\n[文件] 报告.pdf"))
        val b = Bundle("开发群", 3, listOf(1, 2, 3), listOf(BundleLine("小明", "你好"), BundleLine("小红", "收到")))
        assertEquals("[聊天记录] 开发群 · 共 3 条\n小明: 你好\n小红: 收到", copyText(msg("[聊天记录] 开发群", bundle = b)))
        assertEquals("普通", copyText(msg("普通")))
    }

    @Test
    fun HTML卡片去掉标签() {
        assertEquals("周报\n本周 3 个提交 & 1 个 PR", htmlText("<html><head><style>p{}</style></head><body><h1>周报</h1><p>本周 3 个提交 &amp; 1 个 PR</p></body></html>"))
    }

    @Test
    fun 只清七天前的拍照原图() {
        val day = 24 * 3600_000L
        assertTrue(Photos.stale("photo_1.jpg", true, 0, 8 * day))
        assertFalse(Photos.stale("photo_1.jpg", true, 2 * day, 8 * day))
        assertFalse(Photos.stale("abc123", false, 0, 8 * day))
        assertFalse(Photos.stale("报告.pdf", true, 0, 8 * day))
    }
}
