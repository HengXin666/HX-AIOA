package com.hengxin.aioa.ui

import com.hengxin.aioa.browser.Browser
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.proto.Envelope
import com.hengxin.aioa.proto.chatText
import com.hengxin.aioa.ui.chat.HtmlCard
import com.hengxin.aioa.ui.chat.MarkdownText
import com.hengxin.aioa.ui.chat.MdColors

private const val HTML_MAX_DP = 4000

/** 点开总览里的一条 (邮件以外): 完整渲染 Markdown 或 HTML 卡片, 可去所在的群定位到它, 或打开链接。 */
@Composable
fun EventSheet(ev: Envelope, onClose: () -> Unit, toChat: () -> Unit) {
    val c = Aioa.colors
    val context = LocalContext.current
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        BackHandler(onBack = onClose)
        Column(Modifier.fillMaxSize().background(c.background).systemBarsPadding()) {
            Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp, top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("${ev.source.name} · ${ago(ev.ts)}", c.textSecondary, 12, Modifier.weight(1f))
                TextButton(onClose) { Text("关闭", c.accent, 14) }
            }
            Column(
                Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(ev.title, c.text, 18, weight = FontWeight.SemiBold)
                val html = ev.html
                if (html != null) {
                    HtmlCard(html, maxHeight = HTML_MAX_DP.dp)
                } else {
                    val body = ev.markdown ?: ev.summary ?: ""
                    val text = if (body.isNotEmpty()) body else ev.chatText()
                    MarkdownText(text, MdColors(c.text, c.textSecondary, c.accent, c.surfaceAlt))
                }
            }
            Row(Modifier.fillMaxWidth().padding(8.dp), horizontalArrangement = Arrangement.End) {
                ev.url?.let { url ->
                    TextButton({ Browser.open(context, url) }) { Text("打开链接", c.accent, 14) }
                }
                TextButton(toChat) { Text("去消息里看", c.accent, 14) }
            }
        }
    }
}
