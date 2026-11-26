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
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
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
fun statusColor(st: String): Color = Aioa.colors.let { c ->
    when (st) { ST_OK -> c.success; ST_GO -> c.accent; ST_DOUBT -> c.warning; else -> c.textSecondary }
}

@Composable
fun SoftTag(text: String, color: Color) {
    Text(text, Modifier.clip(TAG).background(color.copy(alpha = SOFT)).padding(horizontal = 6.dp, vertical = 1.dp), color = color, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
}

/** 一条推送: 站点, 类别, 状态, 收藏, 标题, 摘要, 要做什么, 热度 / 截止 / 链接; 用过了的变淡。点哪里都先出过渡层 (FeedPeek)。 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun FeedItemCard(it: FeedItem, marks: FeedMarks, modifier: Modifier = Modifier, flat: Boolean = false) {
    val c = Aioa.colors
    @Suppress("UNUSED_VARIABLE") val v = marks.version
    val used = marks.has(FeedMarks.USED, it.key)
    val star = marks.has(FeedMarks.STAR, it.key)
    val st = marks.status(it)
    val dead = st == ST_DEAD
    val base = if (flat) modifier else modifier.clip(CARD).background(c.surface).border(1.dp, c.border, CARD)
    // 点卡片 (或卡片上的链接) 先出过渡层, 不直接进浏览器; 旧格式 HTML 条目仍看原卡片
    var peek by remember { mutableStateOf(false) }
    var focus by remember { mutableStateOf<Pair<String, String>?>(null) }
    val html = it.html
    if (peek) {
        val close = { peek = false; focus = null }
        if (html != null) FeedHtmlSheet(it.summary ?: it.title, html, close) else FeedPeek(it, marks, focus, close)
    }
    Column(base.clickable { peek = true }.padding(12.dp).alpha(if (used || dead) USED_ALPHA else 1f)) {
        // 左边站点和标签占满剩余宽度, 收藏固定在最右; 行高不变, 热区 36dp 溢出这一行并右移贴齐卡片边
        Row(Modifier.fillMaxWidth().height(22.dp), verticalAlignment = Alignment.CenterVertically) {
            Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                val site = it.site
                if (site != null) MailAvatar(site, site, 22.dp, fill = true)
                Text(site ?: it.source, Modifier.weight(1f, fill = false), color = c.textSecondary, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (it.kind != TAG_OTHER) SoftTag(LocalFeedTags.current.labelOf(it.kind), kindColor(it.kind))
                st?.let { s -> SoftTag(STATUS_LABEL.getValue(s), statusColor(s)) }
                if (used) SoftTag("用过了", c.textSecondary)
            }
            Box(Modifier.padding(start = 4.dp).offset(x = 8.dp).requiredSize(36.dp).clip(CircleShape).clickable { marks.toggle(FeedMarks.STAR, it.key) }, contentAlignment = Alignment.Center) {
                Icon("star", if (star) c.warning else c.textSecondary, 17.dp)
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
        // 左下: 时间和计数 (拿不到的不画); 右下: 链接, 多个时只露第一个并标 +N, 点了也先出过渡层
        Row(Modifier.padding(top = 8.dp).fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            FlowRow(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                FeedMetas(it)
            }
            it.links.firstOrNull()?.let { link ->
                val more = it.links.size - 1
                LinkChip(if (more > 0) "${link.first} +$more" else link.first, Modifier.padding(start = 8.dp).widthIn(max = 140.dp)) { focus = link; peek = true }
            }
        }
    }
}

@Composable
fun LinkChip(label: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val c = Aioa.colors
    Row(modifier.clip(TAG).clickable(onClick = onClick).padding(vertical = 1.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon("link", c.accent, 13.dp)
        Spacer(Modifier.width(3.dp))
        Text(label, color = c.accent, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** 时间, 热度, 点赞, 评论, 截止; 卡片和过渡层共用, 没有的字段不画。 */
@Composable
fun FeedMetas(it: FeedItem, pushedToo: Boolean = false) {
    Meta("clock", feedTime(it.time))
    if (pushedToo && it.at > 0 && it.at != it.ts) Meta("send", "推送 ${feedTime(it.ts)}")
    it.heat?.takeIf { h -> h > 0 }?.let { h -> Meta("flame", countText(h)) }
    it.likes?.let { n -> Meta("thumbs-up", countText(n)) }
    it.replies?.let { n -> Meta("message-circle", countText(n)) }
    it.until?.let { u -> Meta("calendar-days", "截止 $u") }
}

private const val WAN = 10_000

/** 一万以下原样, 以上写 "1.2万"。 */
fun countText(n: Int): String = if (n < WAN) "$n" else "%.1f万".format(n / WAN.toFloat()).replace(".0万", "万")

/** 今年内 "11-25 14:03", 往年带年份。 */
fun feedTime(ms: Long): String {
    val now = java.util.Calendar.getInstance()
    val t = java.util.Calendar.getInstance().apply { timeInMillis = ms }
    val fmt = if (t.get(java.util.Calendar.YEAR) == now.get(java.util.Calendar.YEAR)) "MM-dd HH:mm" else "yyyy-MM-dd HH:mm"
    return android.text.format.DateFormat.format(fmt, ms).toString()
}

@Composable
fun Meta(icon: String, text: String) {
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
            val tags = LocalFeedTags.current
            items.groupingBy { it.kind }.eachCount().filterKeys { it != TAG_OTHER }.forEach { (k, n) -> SoftTag("${tags.labelOf(k)} $n", kindColor(k)) }
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
