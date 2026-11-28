package com.hengxin.aioa.proto

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** 系统通知正文纯文本化 (#151)。 */
class NotifyTextTest {
    @Test
    fun 去掉Markdown标记() {
        assertEquals("标题\n加粗 斜体 代码\n第一项\n第二项", NotifyText.clean("## 标题\n\n**加粗** *斜体* `代码`\n\n- 第一项\n* 第二项"))
        assertEquals("看文档 和 引用", NotifyText.clean("看[文档](https://a.com/x) 和 [引用][1]\n\n[1]: https://b.com"))
        assertEquals("删除线\n引用一句", NotifyText.clean("~~删除线~~\n> 引用一句"))
        assertEquals("let a = 1", NotifyText.clean("```kotlin\nlet a = 1\n```"))
    }

    @Test
    fun 去掉HTML标签与实体() {
        assertEquals("你好 世界\n第二段 & <b>", NotifyText.clean("<p>你好 <b>世界</b></p><p>第二段 &amp; &lt;b&gt;</p>"))
        assertEquals("点这里", NotifyText.clean("<a href=\"https://x.com\">点这里</a>"))
        assertEquals("正文", NotifyText.clean("<style>p{color:red}</style><!-- 注释 -->正文"))
        assertEquals("https://x.com/a", NotifyText.clean("<https://x.com/a>"))
    }

    @Test
    fun 图片与文件换占位() {
        assertEquals("[图片] 看图", NotifyText.clean("![截图](https://x.com/a.png) 看图"))
        assertEquals("[图片]", NotifyText.clean("<img src=\"a.png\" alt=\"x\">"))
        val pdf = FileRef("f1", "报告.pdf", 10, "application/pdf")
        val png = FileRef("f2", "a.png", 10, "image/png")
        assertEquals("[文件] 报告.pdf", NotifyText.message("[文件] 报告.pdf", pdf))
        assertEquals("[图片] 看这个", NotifyText.message("看这个", png))
        assertEquals("[图片]", NotifyText.message("[文件] a.png", png))
        assertEquals(NotifyText.CARD, NotifyText.message("", card = true))
        assertEquals("[聊天记录] 开发群", NotifyText.message("", bundle = Bundle("开发群", 2, listOf(1, 2), emptyList())))
    }

    @Test
    fun 折叠空白并截断() {
        assertEquals("a b\nc", NotifyText.clean("a \t  b\n\n\n\nc"))
        val long = NotifyText.clean("字".repeat(500))
        assertEquals(NotifyText.MAX_BODY, long.length)
        assertTrue(long.endsWith("…"))
        assertEquals("一 二 三", NotifyText.line("一\n\n二\n- 三"))
        assertEquals("ab…", NotifyText.cut("abcdef", 3))
        // 不把表情的代理对切成半个
        assertEquals("a…", NotifyText.cut("a\uD83D\uDE00bc", 3))
    }

    @Test
    fun 邮件用验证码或要点() {
        assertEquals("验证码 123456 · 登录验证", NotifyText.mail("登录验证", "123456", null, "您的验证码是 123456"))
        assertEquals("账单已出\n本月应付 ¥100", NotifyText.mail("账单已出", null, "本月应付 **¥100**", "长摘要"))
        assertEquals("周报\n本周进展", NotifyText.mail("周报", "", "", "<p>本周进展</p>"))
    }
}
