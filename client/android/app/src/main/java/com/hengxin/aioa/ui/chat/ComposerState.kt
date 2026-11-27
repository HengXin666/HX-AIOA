package com.hengxin.aioa.ui.chat

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue

/** 输入框的状态: 正文与光标, 以及选过的 @ (发送时只算正文里还留着的)。 */
class ComposerState {
    var value by mutableStateOf(TextFieldValue(""))
    val picked = mutableStateListOf<MentionTarget>()

    val text get() = value.text

    /** 正在输的 "@xx" 里的 xx; 没在输 @ 时为 null。 */
    val query: String? get() = MentionOps.query(value.text.take(value.selection.start))

    /** 选中候选: 把光标前的 "@xx" 换成 "@名字 "。 */
    fun pick(t: MentionTarget) {
        val cur = value.selection.start
        val before = value.text.take(cur)
        val at = before.lastIndexOf('@').takeIf { it >= 0 } ?: cur
        replace(at, cur, "@${t.label} ")
        remember(t)
    }

    /** 长按头像 / 资料卡 @TA: 在光标处插入 "@名字 "。 */
    fun mention(t: MentionTarget) {
        val cur = value.selection.start
        replace(cur, cur, "@${t.label} ")
        remember(t)
    }

    fun insert(s: String) {
        val sel = value.selection
        replace(sel.min, sel.max, s)
    }

    fun tokens(): List<String> = MentionOps.tokens(value.text, picked)

    fun clear() {
        value = TextFieldValue("")
        picked.clear()
    }

    private fun remember(t: MentionTarget) {
        if (picked.none { it.token == t.token }) picked.add(t)
    }

    private fun replace(from: Int, to: Int, s: String) {
        val t = value.text
        val next = t.substring(0, from) + s + t.substring(to)
        value = TextFieldValue(next, TextRange(from + s.length))
    }
}
