package com.hengxin.aioa.ui.feed

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.hengxin.aioa.browser.Browser
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Icon

/** 没有链接的条目点开: 全部字段不截断, 可选中复制; 缺的字段不画。 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun FeedDetail(it: FeedItem, marks: FeedMarks, onClose: () -> Unit) {
    val context = LocalContext.current
    val c = Aioa.colors
    @Suppress("UNUSED_VARIABLE") val v = marks.version
    val st = marks.status(it)
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        BackHandler(onBack = onClose)
        Column(Modifier.fillMaxSize().background(c.background).systemBarsPadding()) {
            Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp, top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(it.site ?: it.source, Modifier.weight(1f), color = c.textSecondary, fontSize = 13.sp, maxLines = 1)
                TextButton(onClose) { Text("关闭", color = c.accent, fontSize = 14.sp) }
            }
            SelectionContainer(Modifier.weight(1f)) {
                Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        if (it.kind != TAG_OTHER) SoftTag(LocalFeedTags.current.labelOf(it.kind), kindColor(it.kind))
                        st?.let { s -> SoftTag(STATUS_LABEL.getValue(s), statusColor(s)) }
                    }
                    Text(it.title, color = c.text, fontSize = 18.sp, fontWeight = FontWeight.SemiBold, lineHeight = 25.sp)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Meta("clock", feedTime(it.time))
                        if (it.at > 0 && it.at != it.ts) Meta("send", "推送 ${feedTime(it.ts)}")
                        it.heat?.takeIf { h -> h > 0 }?.let { h -> Meta("flame", "$h") }
                        it.until?.let { u -> Meta("calendar-days", "截止 $u") }
                    }
                    it.summary?.let { s -> Text(s, color = c.text, fontSize = 15.sp, lineHeight = 22.sp) }
                    it.todo?.let { s ->
                        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(c.surfaceAlt).padding(12.dp)) {
                            Icon("list-checks", c.accent, 16.dp, Modifier.padding(top = 2.dp))
                            Spacer(Modifier.width(8.dp))
                            Text(s, color = c.text, fontSize = 14.sp, lineHeight = 20.sp)
                        }
                    }
                    if (it.links.isNotEmpty()) {
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            it.links.forEach { (label, url) -> LinkChip(label) { Browser.open(context, url) } }
                        }
                    }
                }
            }
        }
    }
}
