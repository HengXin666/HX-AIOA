package com.hengxin.aioa.ui.chat

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** 与服务端同一份快照 (protocol/fixtures/mail, 由 server/test/mail-digest.test.ts 生成): 两边规则保持一致。 */
class MailDigestTest {
    private val dir = File("../../../protocol/fixtures/mail")
    private val ts = 1795824000000L
    private val field = Regex("\"(\\w+)\": \"((?:[^\"\\\\]++|\\\\.)*+)\"")
    private val caseKey = Regex("\\n {2}\"([\\w-]+)\": \\{")

    private fun unescape(s: String): String {
        val out = StringBuilder()
        var i = 0
        while (i < s.length) {
            val ch = s[i]
            if (ch != '\\' || i + 1 >= s.length) { out.append(ch); i++; continue }
            when (val e = s[i + 1]) {
                'n' -> out.append('\n')
                't' -> out.append('\t')
                'u' -> { out.append(s.substring(i + 2, i + 6).toInt(16).toChar()); i += 4 }
                else -> out.append(e)
            }
            i += 2
        }
        return out.toString()
    }

    private fun fields(block: String, key: String): List<String> = field.findAll(block).filter { it.groupValues[1] == key }.map { unescape(it.groupValues[2]) }.toList()

    private fun snapshots(): Map<String, String> {
        val text = File(dir, "snapshots.json").readText()
        val keys = caseKey.findAll(text).toList()
        return keys.mapIndexed { i, m -> m.groupValues[1] to text.substring(m.range.last, keys.getOrNull(i + 1)?.range?.first ?: text.length) }.toMap()
    }

    private fun digests(): Map<String, MailDigest> = File(dir, "cases.json").readLines().filter { "\"name\"" in it }.associate { line ->
        val f = field.findAll(line).associate { it.groupValues[1] to unescape(it.groupValues[2]) }
        val name = f.getValue("name")
        val html = File(dir, "$name.html").takeIf { it.exists() }?.readText()
        val text = File(dir, "$name.txt").takeIf { it.exists() }?.readText()
        name to MailExtract.digest(f.getValue("subject"), f.getValue("from"), f["sender"], html, text, ts)
    }

    @Test
    fun sameAsServerSnapshot() {
        val snap = snapshots()
        val got = digests()
        assertEquals(snap.keys, got.keys)
        for ((name, d) in got) {
            val b = snap.getValue(name)
            assertEquals(fields(b, "body").first(), d.body, "$name body")
            assertEquals(fields(b, "brief").first(), d.brief, "$name brief")
            assertEquals(fields(b, "kind").first(), d.kind, "$name kind")
            assertEquals(fields(b, "code").firstOrNull(), d.otp?.code, "$name otp")
            assertEquals(Regex("\"expiresAt\": (\\d+)").find(b)?.groupValues?.get(1)?.toLong(), d.otp?.expiresAt, "$name expiresAt")
            assertEquals(fields(b, "url"), d.links.map { it.url }, "$name links")
            assertEquals(fields(b, "value"), d.facts.map { it.value }, "$name facts")
        }
    }

    @Test
    fun oldEventFallback() {
        // 老事件只有 500 字纯文本摘要, 没有 HTML
        val d = MailExtract.digest("登录验证码", "a@example.cn", null, null, "您的验证码为 735 194, 10 分钟内有效。", ts)
        assertEquals(MailOtp("735194", ts + 600_000), d.otp)
        assertNull(MailExtract.digest("Re: [a/b] release", "notifications@github.com", null, null, "规则统计: code-path: 2\n其余 1488 项", ts).otp)
        assertTrue(MailClean.mailText("<p>a<span style=\"display:none\">x<span>y</span>z</span>b</p>", null).text == "ab")
        assertEquals("第一行\n第二行", MailClean.mailText("<pre>第一行\r\n\r\n  第二行</pre>", null).text)
    }
}
