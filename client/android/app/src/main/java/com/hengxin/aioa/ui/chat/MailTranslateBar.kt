package com.hengxin.aioa.ui.chat

import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Icon

private const val WAN = 10000.0

/** 翻译习惯 (存本机): 哪些外文自动翻, 哪些发件人不提示, 是否提示过 "按住看原文"。 */
class MailTrPrefs private constructor(context: Context) {
    private val sp = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    var version by mutableIntStateOf(0)
        private set
    val auto: Set<String> get() = sp.getStringSet(KEY_AUTO, emptySet()).orEmpty()
    val muted: Set<String> get() = sp.getStringSet(KEY_MUTED, emptySet()).orEmpty()
    var hinted: Boolean
        get() = sp.getBoolean(KEY_HINT, false)
        set(v) { sp.edit().putBoolean(KEY_HINT, v).apply() }

    fun setAuto(lang: String, on: Boolean) = put(KEY_AUTO, if (on) auto + lang else auto - lang)
    fun setMuted(site: String, on: Boolean) = put(KEY_MUTED, if (on) muted + site else muted - site)

    private fun put(k: String, v: Set<String>) {
        sp.edit().putStringSet(k, v).apply()
        version++
    }

    companion object {
        private const val PREFS = "mail-translate"
        private const val KEY_AUTO = "auto"
        private const val KEY_MUTED = "muted"
        private const val KEY_HINT = "hinted"
        @Volatile private var one: MailTrPrefs? = null
        fun of(context: Context): MailTrPrefs = one ?: synchronized(this) { one ?: MailTrPrefs(context.applicationContext).also { one = it } }
    }
}

/**
 * 发件人下面那一行灰色小字: "英文邮件 · 翻译成中文"。
 * 点一下翻译 / 切换原文, 长按出设置; 中文邮件和不提示的发件人不显示。
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun TranslateLine(m: MailItem, tr: MailTr, lang: String, run: () -> Unit, cancel: () -> Unit) {
    val c = Aioa.colors
    val context = LocalContext.current
    var sheet by remember { mutableStateOf(false) }
    LaunchedEffect(tr.phase) {
        val p = MailTrPrefs.of(context)
        if (tr.phase == PHASE_DONE && !p.hinted && tr.page != null) {
            p.hinted = true
            Toast.makeText(context, "按住某一段可看原文", Toast.LENGTH_SHORT).show()
        }
    }
    val tap: () -> Unit = when (tr.phase) {
        PHASE_RUNNING -> cancel
        PHASE_DONE -> { { tr.showing = !tr.showing } }
        else -> run
    }
    val (lead, act) = when {
        tr.phase == PHASE_RUNNING -> "正在翻译 · ${tr.done} / ${maxOf(tr.total, 1)} 段" to "取消"
        tr.phase == PHASE_ERROR -> (tr.error ?: "翻译失败") to "重试"
        tr.phase == PHASE_DONE && tr.showing -> "已译为中文" to "显示原文"
        tr.phase == PHASE_DONE -> "${lang}邮件" to "显示译文"
        else -> "${lang}邮件" to "翻译成中文"
    }
    Row(
        Modifier.padding(top = 10.dp).clip(RoundedCornerShape(6.dp)).combinedClickable(onClick = tap, onLongClick = { sheet = true }).padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon("languages", c.textSecondary, 15.dp)
        Text(buildAnnotatedString {
            append(lead)
            append(" · ")
            withStyle(SpanStyle(color = c.accent, fontWeight = FontWeight.SemiBold)) { append(act) }
        }, Modifier.padding(start = 6.dp), color = if (tr.phase == PHASE_ERROR) c.danger else c.textSecondary, fontSize = 12.5.sp)
    }
    if (sheet) TranslateSheet(m, lang) { sheet = false }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TranslateSheet(m: MailItem, lang: String, close: () -> Unit) {
    val c = Aioa.colors
    val context = LocalContext.current
    val p = MailTrPrefs.of(context)
    @Suppress("UNUSED_VARIABLE") val v = p.version
    val site = MailAddr.site(m.from)
    val auto = lang in p.auto
    val muted = site in p.muted
    val usage by produceState<Pair<Long, String>?>(null) { value = trUsage(context) }
    ModalBottomSheet(close, containerColor = c.surface) {
        Column(Modifier.navigationBarsPadding().padding(bottom = 16.dp)) {
            Text("翻译", Modifier.padding(horizontal = 20.dp), color = c.text, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
            Text("选择会记住, 换到别的${lang}邮件也生效。", Modifier.padding(horizontal = 20.dp, vertical = 4.dp), color = c.textSecondary, fontSize = 12.sp)
            SheetRow("languages", "只在我点的时候翻译", checked = !auto && !muted) { p.setAuto(lang, false); p.setMuted(site, false) }
            SheetRow("check-check", "${lang}邮件总是自动翻译", checked = auto && !muted) { p.setAuto(lang, true); p.setMuted(site, false) }
            SheetRow("eye-off", "这个发件人不再提示", hint = "$site · 可在邮件设置里恢复", checked = muted) { p.setMuted(site, true); close() }
            val foot = usage?.let { (used, name) -> " · 本月已翻译 ${"%.1f".format(used / WAN)} 万字符 · $name" } ?: ""
            Text("译成简体中文$foot", Modifier.padding(horizontal = 20.dp, vertical = 8.dp), color = c.textSecondary, fontSize = 12.sp)
        }
    }
}
