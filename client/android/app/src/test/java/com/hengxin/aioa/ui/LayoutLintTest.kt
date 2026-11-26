package com.hengxin.aioa.ui

import java.io.File
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * 布局回归的静态检查 (#109): 不跑界面, 扫源码里常见的错误写法。
 * 新发现一类反复出现的布局问题, 在这里加一条规则。
 */
class LayoutLintTest {
    private val root = File("src/main/java")

    // 一个 Row 的直接子项里同时有 weight(fill = false) 和 Spacer(weight): 两个 weight 平分剩余宽度,
    // 前者用不满的那份空出来, 右边的东西 (时间, 按钮) 就不贴右
    @Test
    fun rowHasNoHalfWeightSpacer() {
        val bad = mutableListOf<String>()
        root.walk().filter { it.extension == "kt" }.forEach { f ->
            val src = f.readText()
            rows(src).forEach { (at, body) ->
                val direct = flatten(body)
                if ("fill = false" in direct && "Spacer(Modifier.weight(" in direct) bad += "${f.name}:${line(src, at)}"
            }
        }
        assertTrue(bad.isEmpty(), "Row 里 weight(fill = false) 与 Spacer(weight) 并列, 右侧不会贴边, 改成内层 Row(Modifier.weight(1f)) 包左边: $bad")
    }

    /** 每个 `Row(...) { ... }` 的起点与花括号里的内容。 */
    private fun rows(src: String): List<Pair<Int, String>> {
        val out = mutableListOf<Pair<Int, String>>()
        var i = src.indexOf("Row(")
        while (i >= 0) {
            val prev = if (i > 0) src[i - 1] else ' '
            if (!prev.isLetterOrDigit()) {
                val close = match(src, i + "Row".length, '(', ')')
                val open = if (close > 0) src.indexOf('{', close) else -1
                if (open > 0 && src.substring(close + 1, open).isBlank()) {
                    val end = match(src, open, '{', '}')
                    if (end > 0) out += i to src.substring(open + 1, end)
                }
            }
            i = src.indexOf("Row(", i + 1)
        }
        return out
    }

    /** 去掉嵌套的花括号块, 只留直接子项。 */
    private fun flatten(body: String): String {
        val sb = StringBuilder()
        var depth = 0
        for (ch in body) {
            if (ch == '{') depth++
            if (depth == 0) sb.append(ch)
            if (ch == '}') depth--
        }
        return sb.toString()
    }

    private fun match(s: String, from: Int, open: Char, close: Char): Int {
        var depth = 0
        for (k in from until s.length) {
            if (s[k] == open) depth++
            if (s[k] == close && --depth == 0) return k
        }
        return -1
    }

    private fun line(s: String, at: Int) = s.substring(0, at).count { it == '\n' } + 1
}
