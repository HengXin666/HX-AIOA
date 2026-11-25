package com.hengxin.aioa.ui.feed

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.net.Uri
import android.widget.Toast
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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
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
import com.hengxin.aioa.ui.chat.MailAvatar
import kotlinx.coroutines.launch

private val BOX = RoundedCornerShape(12.dp)
private const val BTN_DP = 44

/**
 * 点卡片先出的过渡层 (底部弹层): 全文不截断可选中, 要去的域名和路径, 复制链接, 收藏, 用过了;
 * 只有点 "打开链接" 或下面某个链接才进浏览器, 误触下滑就关。没有链接的条目同样用它, 只是没有打开按钮。
 * [focus] 是从卡片上某个链接点进来时那条链接, 主按钮就打开它。
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun FeedPeek(it: FeedItem, marks: FeedMarks, focus: Pair<String, String>? = null, onClose: () -> Unit) {
    val context = LocalContext.current
    val c = Aioa.colors
    @Suppress("UNUSED_VARIABLE") val v = marks.version
    val st = marks.status(it)
    val star = marks.has(FeedMarks.STAR, it.key)
    val used = marks.has(FeedMarks.USED, it.key)
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    val target = focus?.second ?: it.url
    // 先收起弹层再跳, 返回时不会看到弹层还挂着
    val go: (String) -> Unit = { url -> scope.launch { state.hide() }.invokeOnCompletion { onClose(); Browser.open(context, url) } }

    ModalBottomSheet(onClose, sheetState = state, containerColor = c.surface) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(start = 16.dp, end = 16.dp, bottom = 12.dp)) {
            SelectionContainer(Modifier.weight(1f, fill = false)) {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        val site = it.site
                        if (site != null) MailAvatar(site, site, 18.dp)
                        Text(site ?: it.source, Modifier.weight(1f, fill = false), color = c.textSecondary, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        if (it.kind != TAG_OTHER) SoftTag(LocalFeedTags.current.labelOf(it.kind), kindColor(it.kind))
                        st?.let { s -> SoftTag(STATUS_LABEL.getValue(s), statusColor(s)) }
                        if (used) SoftTag("用过了", c.textSecondary)
                    }
                    Text(
                        it.title, Modifier.padding(top = 10.dp), color = c.text, fontSize = 18.sp, fontWeight = FontWeight.SemiBold, lineHeight = 25.sp,
                        textDecoration = if (st == ST_DEAD) TextDecoration.LineThrough else null,
                    )
                    it.summary?.let { s -> Text(s, Modifier.padding(top = 8.dp), color = c.text, fontSize = 15.sp, lineHeight = 22.sp) }
                    it.todo?.let { s ->
                        Row(Modifier.padding(top = 12.dp).fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(c.surfaceAlt).padding(12.dp)) {
                            Icon("list-checks", c.accent, 16.dp, Modifier.padding(top = 2.dp))
                            Spacer(Modifier.width(8.dp))
                            Text(s, color = c.text, fontSize = 14.sp, lineHeight = 20.sp)
                        }
                    }
                    FlowRow(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Meta("clock", feedTime(it.time))
                        if (it.at > 0 && it.at != it.ts) Meta("send", "推送 ${feedTime(it.ts)}")
                        it.heat?.takeIf { h -> h > 0 }?.let { h -> Meta("flame", "$h") }
                        it.until?.let { u -> Meta("calendar-days", "截止 $u") }
                    }
                    target?.let { url -> UrlBox(url, focus?.first) { copyLink(context, url) } }
                    // 其余链接: 点一行就打开, 已经是主按钮的那条不重复列
                    val rest = it.links.filter { (_, u) -> u != target }
                    if (rest.isNotEmpty()) Column(Modifier.padding(top = 8.dp)) { rest.forEach { (label, url) -> LinkRow(label, url) { go(url) } } }
                }
            }
            Row(Modifier.padding(top = 16.dp).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SquareButton("star", if (star) c.warning else c.text) { marks.toggle(FeedMarks.STAR, it.key) }
                SquareButton("square-check", if (used) c.success else c.text) { marks.toggle(FeedMarks.USED, it.key) }
                if (target != null) {
                    Row(
                        Modifier.weight(1f).height(BTN_DP.dp).clip(BOX).background(c.accent).clickable { go(target) },
                        horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon("external-link", c.onAccent, 17.dp)
                        Spacer(Modifier.width(6.dp))
                        Text("打开链接", color = c.onAccent, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
    }
}

@Composable
private fun UrlBox(url: String, label: String?, onCopy: () -> Unit) {
    val c = Aioa.colors
    val uri = remember(url) { runCatching { Uri.parse(url) }.getOrNull() }
    val host = uri?.host ?: url
    val rest = uri?.let { u -> (u.encodedPath.orEmpty() + (u.encodedQuery?.let { q -> "?$q" } ?: "")).let(Uri::decode) }.orEmpty()
    Row(
        Modifier.padding(top = 14.dp).fillMaxWidth().clip(BOX).background(c.background).border(1.dp, c.border, BOX).padding(start = 12.dp, top = 10.dp, bottom = 10.dp, end = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(30.dp).clip(RoundedCornerShape(8.dp)).background(c.surfaceAlt), contentAlignment = Alignment.Center) { Icon("globe", c.textSecondary, 15.dp) }
        Column(Modifier.padding(start = 10.dp).weight(1f)) {
            Text(if (label != null) "$label · $host" else host, color = c.text, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (rest.isNotBlank() && rest != "/") Text(rest, color = c.textSecondary, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        Box(Modifier.size(40.dp).clip(RoundedCornerShape(8.dp)).clickable(onClick = onCopy), contentAlignment = Alignment.Center) { Icon("copy", c.textSecondary, 16.dp) }
    }
}

@Composable
private fun LinkRow(label: String, url: String, onClick: () -> Unit) {
    val c = Aioa.colors
    val host = remember(url) { runCatching { Uri.parse(url).host }.getOrNull() ?: url }
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).clickable(onClick = onClick).padding(vertical = 10.dp, horizontal = 2.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon("link", c.accent, 15.dp)
        Text(label, Modifier.padding(start = 8.dp).weight(1f), color = c.text, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(host, Modifier.padding(start = 8.dp), color = c.textSecondary, fontSize = 12.sp, maxLines = 1)
        Icon("chevron-right", c.textSecondary, 15.dp, Modifier.padding(start = 4.dp))
    }
}

@Composable
private fun SquareButton(icon: String, tint: androidx.compose.ui.graphics.Color, onClick: () -> Unit) {
    val c = Aioa.colors
    Box(Modifier.size(BTN_DP.dp).clip(BOX).background(c.surfaceAlt).clickable(onClick = onClick), contentAlignment = Alignment.Center) { Icon(icon, tint, 19.dp) }
}

private fun copyLink(context: Context, url: String) {
    val cm = context.getSystemService(ClipboardManager::class.java) ?: return
    cm.setPrimaryClip(ClipData.newPlainText("链接", url))
    Toast.makeText(context, "已复制链接", Toast.LENGTH_SHORT).show()
}
