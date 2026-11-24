package com.hengxin.aioa.ui.chat

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Icon
import kotlinx.coroutines.launch

private const val PREFETCH = 8
private const val AVATAR = 44

/** 会话列表: 下拉刷新, 按日期分段 (吸顶), 左滑露出删除按钮, 右滑切换已读。 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun MailList(s: MailState, refresh: () -> Unit, loadMore: () -> Unit) {
    val c = Aioa.colors
    val state = rememberLazyListState()
    val nearEnd by remember { derivedStateOf { (state.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) >= state.layoutInfo.totalItemsCount - PREFETCH } }
    LaunchedEffect(nearEnd, s.items.size) { if (nearEnd) loadMore() }
    val sections = remember(s.items.toList()) { sectionsOf(s.threads) }
    @Suppress("UNUSED_VARIABLE") val v = s.seen.version
    PullToRefreshBox(s.refreshing, refresh, Modifier.fillMaxSize()) {
        if (s.items.isEmpty() && !s.loading) {
            EmptyMail(if (s.query != null) "没有匹配的邮件" else "还没有邮件")
            return@PullToRefreshBox
        }
        LazyColumn(Modifier.fillMaxSize(), state, contentPadding = PaddingValues(bottom = 24.dp)) {
            sections.forEach { (label, threads) ->
                stickyHeader(key = "h:$label") {
                    Text(label, Modifier.fillMaxWidth().background(c.background).padding(horizontal = MAIL_PAD.dp, vertical = 6.dp), color = c.textSecondary, fontSize = 12.sp)
                }
                items(threads, key = { it.key }) { t -> SwipeRow(s, t) }
            }
        }
    }
}

@Composable
private fun EmptyMail(text: String) {
    val c = Aioa.colors
    Column(Modifier.fillMaxWidth().padding(top = 80.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Icon("inbox", c.textSecondary, 40.dp)
        Spacer(Modifier.height(10.dp))
        Text(text, color = c.textSecondary, fontSize = 14.sp)
    }
}

@Composable
private fun SwipeRow(s: MailState, t: MailThread) {
    val c = Aioa.colors
    val scope = rememberCoroutineScope()
    val unread = t.items.any(s.seen::unread)
    val open = s.swiped == t.key
    val del = RevealAction("trash-2", "删除", c.danger) { scope.launch { s.remove(t) } }
    val read = SwipeQuick(if (unread) "mail-open" else "mail", c.accent) { s.seen.set(t.items, unread) }
    SwipeReveal(open, { s.swiped = if (it) t.key else if (open) null else s.swiped }, listOf(del), read) {
        Column(Modifier.background(c.surface)) {
            ThreadRow(t, unread) {
                if (s.swiped != null) s.swiped = null else { s.open = t.key; s.seen.set(t.items, true) }
            }
            HorizontalDivider(Modifier.padding(start = (MAIL_PAD * 2 + AVATAR - 4).dp), color = c.border, thickness = 0.5.dp)
        }
    }
}

@Composable
private fun ThreadRow(t: MailThread, unread: Boolean, onClick: () -> Unit) {
    val context = LocalContext.current
    val c = Aioa.colors
    val m = t.head
    val bold = if (unread) FontWeight.Bold else FontWeight.Normal
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(start = 6.dp, end = MAIL_PAD.dp, top = 12.dp, bottom = 12.dp)) {
        Box(Modifier.width(10.dp).padding(top = 18.dp), contentAlignment = Alignment.Center) {
            if (unread) Box(Modifier.size(7.dp).clip(CircleShape).background(c.accent))
        }
        MailAvatar(m.from, m.name ?: m.vendor, AVATAR.dp)
        Column(Modifier.padding(start = 12.dp).weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(m.name ?: m.from, Modifier.weight(1f, fill = false), color = c.text, fontSize = 15.sp, fontWeight = bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (t.items.size > 1) CountBadge(t.items.size)
                Spacer(Modifier.weight(1f))
                Text(mailTime(context, m.ts), color = if (unread) c.accent else c.textSecondary, fontSize = 12.sp)
            }
            Text(m.subject, color = c.text, fontSize = 14.sp, fontWeight = if (unread) FontWeight.SemiBold else FontWeight.Normal, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 2.dp))
            if (m.summary.isNotEmpty()) Text(m.summary, color = c.textSecondary, fontSize = 13.sp, lineHeight = 18.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 2.dp))
            MailTags(m)
        }
    }
}

@Composable
fun CountBadge(n: Int) {
    val c = Aioa.colors
    Text("$n", Modifier.clip(RoundedCornerShape(8.dp)).background(c.surfaceAlt).padding(horizontal = 6.dp), color = c.textSecondary, fontSize = 11.sp)
}

/** 验证码 / 可疑 / 经由仓库 等小标签。 */
@Composable
fun MailTags(m: MailItem) {
    val c = Aioa.colors
    val context = LocalContext.current
    val repo = m.list?.substringBefore('@')?.takeIf { m.vendor == GITHUB }
    if (m.code == null && !m.spoof && repo == null) return
    Row(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        m.code?.let { code ->
            Row(Modifier.clip(RoundedCornerShape(6.dp)).background(c.accent.copy(alpha = TAG_ALPHA)).clickable { copyCode(context, code) }.padding(horizontal = 8.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(code, color = c.accent, fontSize = 13.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace)
                Spacer(Modifier.width(4.dp))
                Icon("copy", c.accent, 12.dp)
            }
        }
        if (m.spoof) Tag("可疑发件人", c.danger)
        repo?.let { Tag(it, c.textSecondary) }
    }
}

@Composable
fun Tag(text: String, color: Color) {
    Text(text, Modifier.clip(RoundedCornerShape(4.dp)).background(color.copy(alpha = TAG_ALPHA)).padding(horizontal = 6.dp, vertical = 1.dp), color = color, fontSize = 11.sp)
}

private const val TAG_ALPHA = 0.12f
private const val GITHUB = "GitHub"
