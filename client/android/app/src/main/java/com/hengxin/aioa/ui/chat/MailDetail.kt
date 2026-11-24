package com.hengxin.aioa.ui.chat

import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.pressable
import kotlinx.coroutines.launch

private const val BODY_HTML = "html"
private val VIA_LABEL = mapOf("cf" to "Cloudflare 邮件路由", "hx-email" to "HX-Email", "api" to "接口推送")

/** 一串信的详情: 当前这封的主题, 发件人, 收件信息, 正文; 下面是同主题的其它信, 底部操作栏。 */
@Composable
fun MailDetail(t: MailThread, s: MailState, back: () -> Unit) {
    val c = Aioa.colors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var cur by remember(t.key) { mutableStateOf(t.head.id) }
    val m = t.items.firstOrNull { it.id == cur } ?: t.head
    var full by remember { mutableStateOf<String?>(null) }
    var fetching by remember { mutableStateOf(false) }
    BackHandler(onBack = back)
    fun original() {
        if (fetching || m.body == null) return
        fetching = true
        scope.launch {
            s.api.body(m.id).onSuccess { full = it }.onFailure { Toast.makeText(context, it.message, Toast.LENGTH_SHORT).show() }
            fetching = false
        }
    }
    Column(Modifier.fillMaxSize().background(c.background)) {
        Row(Modifier.fillMaxWidth().background(c.surface).padding(horizontal = 4.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(44.dp).clip(CircleShape).pressable(back), contentAlignment = Alignment.Center) { Icon("chevron-left", c.text, 24.dp) }
            Text(if (t.items.size > 1) "${m.vendor} · ${t.items.size} 封" else m.vendor, color = c.text, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            Column(Modifier.fillMaxWidth().background(c.surface).padding(MAIL_PAD.dp)) {
                SelectionContainer { Text(m.subject, color = c.text, fontSize = 20.sp, fontWeight = FontWeight.Bold, lineHeight = 27.sp) }
                Row(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    m.category?.let { Tag(it, c.textSecondary) }
                    if (m.spoof) Tag("可疑: 发件域名校验失败", c.danger)
                }
                Sender(m)
                Recipient(m)
                m.code?.let { code ->
                    Row(Modifier.padding(top = 12.dp).clip(RoundedCornerShape(12.dp)).background(c.accent.copy(alpha = SOFT)).clickable { copyCode(context, code) }.padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("验证码", color = c.accent, fontSize = 13.sp)
                        Spacer(Modifier.width(10.dp))
                        Text(code, color = c.accent, fontSize = 22.sp, fontWeight = FontWeight.Bold, letterSpacing = 2.sp)
                        Spacer(Modifier.width(10.dp))
                        Icon("copy", c.accent, 16.dp)
                    }
                }
                Column(Modifier.padding(top = 14.dp).fillMaxWidth().clip(RoundedCornerShape(12.dp)).border(1.dp, c.border, RoundedCornerShape(12.dp)).padding(14.dp)) {
                    SelectionContainer { Text(m.summary.ifEmpty { "(没有正文摘要)" }, color = c.text, fontSize = 14.sp, lineHeight = 22.sp) }
                    if (m.body != null) {
                        Row(Modifier.padding(top = 12.dp).clip(RoundedCornerShape(8.dp)).background(c.surfaceAlt).pressable(::original).padding(horizontal = 12.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon("file-text", c.text, 15.dp)
                            Spacer(Modifier.width(6.dp))
                            Text(if (fetching) "加载中..." else if (m.body == BODY_HTML) "查看原文" else "查看全文", color = c.text, fontSize = 13.sp)
                        }
                    }
                }
            }
            if (t.items.size > 1) Others(t, m.id) { cur = it; s.seen.set(t.items.filter { x -> x.id == it }, true) }
            Spacer(Modifier.height(24.dp))
        }
        ActionBar(m, s, ::original) { scope.launch { s.remove(MailThread(t.key, listOf(m))) }; if (t.items.size == 1) back() }
    }
    full?.let { HtmlViewer(it, m.subject) { full = null } }
}

@Composable
private fun Sender(m: MailItem) {
    val c = Aioa.colors
    val context = LocalContext.current
    Row(Modifier.padding(top = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        MailAvatar(m.from, m.name ?: m.vendor, 40.dp)
        Column(Modifier.padding(start = 12.dp).weight(1f)) {
            Text(m.name ?: m.from, color = c.text, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("${m.from} · ${mailTime(context, m.ts)}", color = c.textSecondary, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** "发给 我 · 账号", 点开看经由的中转地址, 实际投递地址和来源。 */
@Composable
private fun Recipient(m: MailItem) {
    val c = Aioa.colors
    var open by remember { mutableStateOf(false) }
    Column(Modifier.padding(top = 12.dp).fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(c.surfaceAlt).clickable { open = !open }.animateContentSize().padding(horizontal = 12.dp, vertical = 10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(buildAnnotatedString {
                append("发给 ")
                withStyle(SpanStyle(color = c.text, fontWeight = FontWeight.Medium)) { append("我 · ${accountLabel(m.account)}") }
            }, Modifier.weight(1f), color = c.textSecondary, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Icon(if (open) "chevron-up" else "chevron-down", c.textSecondary, 16.dp)
        }
        if (open) {
            m.list?.let { Line("经", it) }
            m.rcpt?.let { Line("投递到", it) }
            Line("来源", (VIA_LABEL[m.via] ?: m.via) + if (m.spoof) " · 校验失败" else "")
        }
    }
}

@Composable
private fun Line(k: String, v: String) {
    val c = Aioa.colors
    Row(Modifier.padding(top = 6.dp)) {
        Text(k, Modifier.width(52.dp), color = c.textSecondary, fontSize = 12.sp)
        Text(v, color = c.text, fontSize = 12.sp)
    }
}

@Composable
private fun Others(t: MailThread, cur: String, pick: (String) -> Unit) {
    val c = Aioa.colors
    val context = LocalContext.current
    Text("同一主题 ${t.items.size} 封", Modifier.padding(start = MAIL_PAD.dp, top = 16.dp, bottom = 6.dp), color = c.textSecondary, fontSize = 12.sp)
    Column(Modifier.padding(horizontal = MAIL_PAD.dp).clip(RoundedCornerShape(12.dp)).background(c.surface)) {
        t.items.forEachIndexed { i, x ->
            if (i > 0) HorizontalDivider(color = c.border, thickness = 0.5.dp)
            val on = x.id == cur
            Row(Modifier.fillMaxWidth().clickable { pick(x.id) }.padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(x.name ?: x.from, color = if (on) c.accent else c.text, fontSize = 14.sp, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal, maxLines = 1)
                    Text(x.summary.ifEmpty { x.subject }, color = c.textSecondary, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Text(mailTime(context, x.ts), color = c.textSecondary, fontSize = 12.sp, modifier = Modifier.padding(start = 8.dp))
            }
        }
    }
}

@Composable
private fun ActionBar(m: MailItem, s: MailState, original: () -> Unit, delete: () -> Unit) {
    val c = Aioa.colors
    @Suppress("UNUSED_VARIABLE") val v = s.seen.version
    val unread = s.seen.unread(m)
    Column(Modifier.fillMaxWidth().background(c.surface)) {
        HorizontalDivider(color = c.border, thickness = 0.5.dp)
        Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
            if (m.body != null) Action("file-text", "原文", original)
            Action(if (unread) "mail-open" else "mail", if (unread) "标为已读" else "标为未读") { s.seen.set(listOf(m), unread) }
            Action("trash-2", "删除", delete)
        }
    }
}

@Composable
private fun Action(icon: String, label: String, onClick: () -> Unit) {
    val c = Aioa.colors
    Column(Modifier.clip(RoundedCornerShape(10.dp)).pressable(onClick).padding(horizontal = 18.dp, vertical = 6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(icon, c.textSecondary, 20.dp)
        Text(label, color = c.textSecondary, fontSize = 11.sp, modifier = Modifier.padding(top = 2.dp))
    }
}

private const val SOFT = 0.1f
