package com.hengxin.aioa.ui.chat

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.pressable
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

const val MAIL_PAD = 16
// 停止输入这么久才搜, 避免每个字都请求
private const val SEARCH_DEBOUNCE_MS = 400L
private const val SLIDE_MS = 260
private val PILL = RoundedCornerShape(50)

/** 邮件视图 (仿 QQ 邮箱手机版): 账号切换, 搜索, 分类, 按日期分段的会话列表, 点开进详情。 */
@Composable
fun MailView(head: Long?, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val s = remember { MailState(MailApi(context.applicationContext), MailSeen(context.applicationContext)) }
    val scope = rememberCoroutineScope()
    // 群里来了新信 (head 变了) 或筛选变了就刷新第一页
    LaunchedEffect(head, s.account, s.category, s.vendor, s.query) { s.reload() }
    LaunchedEffect(s.search) { delay(SEARCH_DEBOUNCE_MS); s.query = s.search.trim().ifEmpty { null } }
    BackHandler(s.open == null && (s.vendors || s.vendor != null || s.category != null)) { s.vendors = false; s.vendor = null; s.category = null }
    val c = Aioa.colors
    Box(modifier.background(c.background)) {
        Column(Modifier.fillMaxSize()) {
            AccountBar(s)
            SearchPill(s)
            FilterChips(s)
            s.error?.let { Text(it, Modifier.padding(horizontal = MAIL_PAD.dp, vertical = 4.dp), fontSize = 12.sp, color = c.danger) }
            if (s.vendors && s.vendor == null) VendorList(s.facets.vendors) { s.vendor = it; s.vendors = false }
            else MailList(s, { scope.launch { s.refreshing = true; s.reload() } }) { scope.launch { s.older() } }
        }
        AnimatedVisibility(
            s.open != null,
            enter = slideInHorizontally(tween(SLIDE_MS)) { it } + fadeIn(tween(SLIDE_MS)),
            exit = slideOutHorizontally(tween(SLIDE_MS)) { it } + fadeOut(tween(SLIDE_MS)),
        ) {
            val t = remember(s.open, s.items.size) { s.threads.firstOrNull { it.key == s.open } }
            if (t != null) MailDetail(t, s) { s.open = null }
        }
    }
    if (s.sheet) AccountSheet(s) { s.sheet = false }
}

@Composable
private fun AccountBar(s: MailState) {
    val c = Aioa.colors
    Row(Modifier.fillMaxWidth().padding(start = MAIL_PAD.dp, end = 8.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Row(Modifier.clip(PILL).pressable { s.sheet = true }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(s.title, color = c.text, fontSize = 20.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.width(4.dp))
            Icon("chevron-down", c.textSecondary, 18.dp)
        }
        Spacer(Modifier.weight(1f))
        Box(Modifier.size(40.dp).clip(PILL).pressable { s.seen.allRead() }, contentAlignment = Alignment.Center) { Icon("check-check", c.textSecondary, 20.dp) }
    }
}

@Composable
private fun SearchPill(s: MailState) {
    val c = Aioa.colors
    Row(
        Modifier.fillMaxWidth().padding(horizontal = MAIL_PAD.dp, vertical = 4.dp).clip(RoundedCornerShape(12.dp)).background(c.surfaceAlt).padding(horizontal = 12.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon("search", c.textSecondary, 16.dp)
        Spacer(Modifier.width(8.dp))
        Box(Modifier.weight(1f)) {
            if (s.search.isEmpty()) Text("搜索主题, 发件人", color = c.textSecondary, fontSize = 14.sp)
            BasicTextField(s.search, { s.search = it }, Modifier.fillMaxWidth(), singleLine = true, textStyle = TextStyle(color = c.text, fontSize = 14.sp), cursorBrush = SolidColor(c.accent))
        }
        if (s.search.isNotEmpty()) Box(Modifier.clip(PILL).pressable { s.search = "" }.padding(2.dp)) { Icon("x", c.textSecondary, 16.dp) }
    }
}

@Composable
private fun FilterChips(s: MailState) {
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = MAIL_PAD.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        val counts = s.facets.categories
        MailChip("全部", s.total.takeIf { it > 0 }, s.category == null && s.vendor == null && !s.vendors) { s.category = null; s.vendor = null; s.vendors = false }
        counts.forEach { f -> MailChip(f.key, f.count, s.category == f.key) { s.category = if (s.category == f.key) null else f.key; s.vendors = false } }
        val v = s.vendor
        if (v != null) MailChip(v, null, true, close = true) { s.vendor = null }
        else MailChip("按厂商", null, s.vendors, icon = "layout-dashboard") { s.vendors = !s.vendors }
    }
}

@Composable
private fun MailChip(label: String, count: Int?, on: Boolean, icon: String? = null, close: Boolean = false, onClick: () -> Unit) {
    val c = Aioa.colors
    val fg = if (on) c.accent else c.textSecondary
    Row(
        Modifier.clip(PILL).background(if (on) c.accent.copy(alpha = CHIP_ALPHA) else c.surfaceAlt).pressable(onClick).padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        icon?.let { Icon(it, fg, 14.dp) }
        Text(label, color = fg, fontSize = 13.sp, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal)
        count?.let { Text("$it", color = fg.copy(alpha = COUNT_ALPHA), fontSize = 12.sp) }
        if (close) Icon("x", fg, 14.dp)
    }
}

private const val CHIP_ALPHA = 0.12f
private const val COUNT_ALPHA = 0.7f
