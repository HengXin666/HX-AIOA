package com.hengxin.aioa.ui.feed

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.browser.Browser
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.proto.ServerFrame
import com.hengxin.aioa.ui.chat.MailAvatar

private const val SOFT = 0.12f
private const val USED_ALPHA = 0.55f
private const val COLLAPSED = 3
private val CARD = RoundedCornerShape(14.dp)
private val TAG = RoundedCornerShape(5.dp)

@Composable
fun kindColor(kind: String): Color = Aioa.colors.let { c ->
    when (kind) { KIND_DEAL -> c.warning; KIND_OSS -> c.accent; KIND_NEWS -> c.success; else -> c.textSecondary }
}

@Composable
fun statusColor(st: String): Color = Aioa.colors.let { c ->
    when (st) { ST_OK -> c.success; ST_GO -> c.accent; ST_DOUBT -> c.warning; else -> c.textSecondary }
}

@Composable
fun SoftTag(text: String, color: Color) {
    Text(text, Modifier.clip(TAG).background(color.copy(alpha = SOFT)).padding(horizontal = 6.dp, vertical = 1.dp), color = color, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
}

/** 一条推送: 站点, 类别, 状态, 标题, 摘要, 要做什么, 热度 / 截止 / 链接; 用过了的变淡。 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun FeedItemCard(it: FeedItem, marks: FeedMarks, modifier: Modifier = Modifier, flat: Boolean = false) {
    val context = LocalContext.current
    val c = Aioa.colors
    @Suppress("UNUSED_VARIABLE") val v = marks.version
    val used = marks.has(FeedMarks.USED, it.key)
    val star = marks.has(FeedMarks.STAR, it.key)
    val st = marks.status(it)
    val dead = st == ST_DEAD
    val base = if (flat) modifier else modifier.clip(CARD).background(c.surface).border(1.dp, c.border, CARD)
    Column(base.clickable(enabled = it.url != null) { Browser.open(context, it.url) }.padding(12.dp).alpha(if (used || dead) USED_ALPHA else 1f)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            val site = it.site
            if (site != null) MailAvatar(site, site, 18.dp)
            Text(site ?: it.source, Modifier.weight(1f, fill = false), color = c.textSecondary, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (it.kind != KIND_OTHER) SoftTag(KIND_LABEL.getValue(it.kind), kindColor(it.kind))
            st?.let { s -> SoftTag(STATUS_LABEL.getValue(s), statusColor(s)) }
            if (used) SoftTag("用过了", c.textSecondary)
            Spacer(Modifier.weight(1f))
            Box(Modifier.size(28.dp).clip(CircleShape).clickable { marks.toggle(FeedMarks.STAR, it.key) }, contentAlignment = Alignment.Center) {
                Icon("star", if (star) c.warning else c.textSecondary, 16.dp)
            }
        }
        Text(
            it.title, Modifier.padding(top = 6.dp), color = c.text, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, lineHeight = 21.sp, maxLines = 3, overflow = TextOverflow.Ellipsis,
            textDecoration = if (dead) TextDecoration.LineThrough else null,
        )
        it.summary?.let { s -> Text(s, Modifier.padding(top = 4.dp), color = c.textSecondary, fontSize = 13.sp, lineHeight = 19.sp, maxLines = 4, overflow = TextOverflow.Ellipsis) }
        it.todo?.let { s ->
            Row(Modifier.padding(top = 8.dp).fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(c.surfaceAlt).padding(horizontal = 10.dp, vertical = 7.dp)) {
                Icon("list-checks", c.accent, 15.dp, Modifier.padding(top = 1.dp))
                Spacer(Modifier.width(6.dp))
                Text(s, color = c.text, fontSize = 13.sp, lineHeight = 18.sp)
            }
        }
        if (it.heat != null || it.until != null || it.links.isNotEmpty()) {
            FlowRow(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                it.heat?.takeIf { h -> h > 0 }?.let { h -> Meta("flame", "$h") }
                it.until?.let { u -> Meta("calendar-days", "截止 $u") }
                it.links.forEach { (label, url) ->
                    Row(Modifier.clip(TAG).clickable { Browser.open(context, url) }.padding(vertical = 1.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon("link", c.accent, 13.dp)
                        Spacer(Modifier.width(3.dp))
                        Text(label, color = c.accent, fontSize = 12.sp)
                    }
                }
            }
        }
    }
}

@Composable
private fun Meta(icon: String, text: String) {
    val c = Aioa.colors
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, c.textSecondary, 13.dp)
        Spacer(Modifier.width(3.dp))
        Text(text, color = c.textSecondary, fontSize = 12.sp)
    }
}

/** 聊天里的推送卡: 头部 "来源 · N 条" 和类别计数, 先露 3 条, 其余点开。 */
@Composable
fun FeedBubble(m: ServerFrame.Msg, footer: @Composable () -> Unit) {
    val context = LocalContext.current
    val c = Aioa.colors
    val items = remember(m.feed) { feedOf(m) }
    val marks = remember { FeedMarks.of(context) }
    var all by remember { mutableStateOf(false) }
    if (items.isEmpty()) return
    Column(Modifier.padding(top = 2.dp).animateContentSize()) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("${items.first().source} · ${items.size} 条", color = c.text, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
            items.groupingBy { it.kind }.eachCount().filterKeys { it != KIND_OTHER }.forEach { (k, n) -> SoftTag("${KIND_LABEL.getValue(k)} $n", kindColor(k)) }
        }
        Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            (if (all) items else items.take(COLLAPSED)).forEach { FeedItemCard(it, marks, Modifier.fillMaxWidth()) }
        }
        Row(Modifier.fillMaxWidth().padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            if (items.size > COLLAPSED) {
                Row(Modifier.clip(TAG).clickable { all = !all }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(if (all) "收起" else "展开其余 ${items.size - COLLAPSED} 条", color = c.accent, fontSize = 13.sp)
                    Icon(if (all) "chevron-up" else "chevron-down", c.accent, 15.dp)
                }
            }
            Spacer(Modifier.weight(1f))
            footer()
        }
    }
}
