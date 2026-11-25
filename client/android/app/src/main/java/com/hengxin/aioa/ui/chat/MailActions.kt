package com.hengxin.aioa.ui.chat

import android.content.ClipData
import android.content.ClipboardManager
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.browser.Browser
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.ui.settings.SwitchRow
import kotlinx.coroutines.launch

private const val SHEET_PAD = 20

/** 点邮件里的链接: 先看真实去向 (能解开的跟踪跳转去掉), 再选内置浏览器打开或复制。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LinkSheet(url: String, spoof: Boolean, close: () -> Unit) {
    val c = Aioa.colors
    val context = LocalContext.current
    val real = remember(url) { unwrapLink(url) }
    val host = remember(real) { runCatching { android.net.Uri.parse(real).host }.getOrNull() ?: real }
    ModalBottomSheet(close, containerColor = c.surface) {
        Column(Modifier.navigationBarsPadding().padding(bottom = 12.dp)) {
            Text("打开链接", Modifier.padding(horizontal = SHEET_PAD.dp), color = c.text, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
            Column(Modifier.padding(SHEET_PAD.dp, 10.dp).fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(c.surfaceAlt).padding(12.dp)) {
                Text(host, color = c.text, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                Text(real, color = c.text, fontSize = 12.sp, maxLines = 3, overflow = TextOverflow.Ellipsis)
                if (real != url) Text("已去掉跟踪跳转: $url", color = c.textSecondary, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, textDecoration = TextDecoration.LineThrough)
            }
            if (spoof) SheetRow("shield-off", "发件域名校验失败, 小心冒充", tint = c.danger) {}
            SheetRow("globe", "内置浏览器打开") { Browser.open(context, real); close() }
            SheetRow("copy", "复制链接") {
                context.getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText("链接", real))
                Toast.makeText(context, "已复制", Toast.LENGTH_SHORT).show()
                close()
            }
        }
    }
}

/**
 * 转进群 / 交给 Agent: agent=true 只列有 Agent 的群。可顺手存成规则, 以后同类邮件到达时服务端自动转。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ForwardSheet(m: MailItem, s: MailState, agent: Boolean, close: () -> Unit) {
    val c = Aioa.colors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var chats by remember { mutableStateOf<List<ChatMeta>?>(null) }
    var pick by remember { mutableStateOf<String?>(null) }
    var save by remember { mutableStateOf(false) }
    var byDomain by remember { mutableStateOf(false) }
    var subject by remember { mutableStateOf("") }
    var keep by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { s.api.chats().onSuccess { list -> chats = if (agent) list.filter { it.agents.isNotEmpty() } else list } }
    ModalBottomSheet(close, containerColor = c.surface) {
        Column(Modifier.navigationBarsPadding().heightIn(max = 640.dp).verticalScroll(rememberScrollState()).padding(bottom = 12.dp)) {
            Text(if (agent) "交给 Agent" else "转进群", Modifier.padding(horizontal = SHEET_PAD.dp), color = c.text, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
            Text(if (agent) "以你的名义把标题, 发件人, 纯文本正文发到 Agent 所在的群, 原文作附件, Agent 照群里的指令处理。" else "以你的名义转进群, 原文作附件。",
                Modifier.padding(SHEET_PAD.dp, 4.dp), color = c.textSecondary, fontSize = 12.sp, lineHeight = 18.sp)
            val list = chats
            when {
                list == null -> Text("加载中...", Modifier.padding(SHEET_PAD.dp), color = c.textSecondary, fontSize = 13.sp)
                list.isEmpty() -> Text(if (agent) "还没有接入 Agent 的群" else "还没有群", Modifier.padding(SHEET_PAD.dp), color = c.textSecondary, fontSize = 13.sp)
                else -> list.forEach { g ->
                    val hint = g.agents.joinToString(" / ") { it.name }.ifEmpty { null }
                    SheetRow(if (g.agents.isEmpty()) "message-circle" else "bot", g.title ?: g.channel, hint, checked = pick == g.channel) { pick = g.channel }
                }
            }
            SwitchRow("以后自动转", save, "同类邮件到达时服务端直接转, 手机不用在线") { save = it }
            if (save) {
                Row(Modifier.padding(SHEET_PAD.dp, 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Choice("这个发件人", !byDomain) { byDomain = false }
                    Choice("整个 ${MailAddr.site(m.from)}", byDomain) { byDomain = true }
                }
                OutlinedTextField(subject, { subject = it }, Modifier.padding(SHEET_PAD.dp, 4.dp).fillMaxWidth(), singleLine = true, label = { Text("标题含 (可空)") })
                SwitchRow("同时在邮件列表里保留", keep) { keep = it }
            }
            val target = pick
            Text(
                if (busy) "转发中..." else if (save) "保存规则并转这封" else "转发",
                Modifier.padding(SHEET_PAD.dp, 10.dp).fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(if (target != null) c.accent else c.surfaceAlt)
                    .clickable(enabled = target != null && !busy) {
                        busy = true
                        scope.launch {
                            val t = target ?: return@launch
                            if (save) {
                                val rule = MailRule(from = m.from.takeIf { !byDomain }, domain = MailAddr.site(m.from).takeIf { byDomain }, subject = subject.trim().ifEmpty { null }, channel = t, keep = keep)
                                if (!s.saveRules(s.rules + rule)) { busy = false; return@launch }
                            }
                            s.api.forward(m.id, t)
                                .onSuccess { Toast.makeText(context, "已转发", Toast.LENGTH_SHORT).show(); close() }
                                .onFailure { Toast.makeText(context, it.message, Toast.LENGTH_SHORT).show() }
                            busy = false
                        }
                    }.padding(12.dp),
                color = if (target != null) c.onAccent else c.textSecondary,
                fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
        }
    }
}

@Composable
private fun Choice(label: String, on: Boolean, onClick: () -> Unit) {
    val c = Aioa.colors
    Text(label, Modifier.clip(RoundedCornerShape(14.dp)).background(if (on) c.accent.copy(alpha = 0.12f) else c.surfaceAlt).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 6.dp),
        color = if (on) c.accent else c.textSecondary, fontSize = 13.sp, maxLines = 1)
}

@Composable
fun SheetRow(icon: String, title: String, hint: String? = null, checked: Boolean = false, tint: androidx.compose.ui.graphics.Color? = null, onClick: () -> Unit) {
    val c = Aioa.colors
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = SHEET_PAD.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, tint ?: if (checked) c.accent else c.textSecondary, 20.dp)
        Column(Modifier.padding(start = 12.dp).weight(1f)) {
            Text(title, color = tint ?: if (checked) c.accent else c.text, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            hint?.let { Text(it, color = c.textSecondary, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        }
        if (checked) Icon("check", c.accent, 18.dp)
    }
}
