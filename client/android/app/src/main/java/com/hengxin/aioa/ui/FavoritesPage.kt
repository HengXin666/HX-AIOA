package com.hengxin.aioa.ui

import com.hengxin.aioa.ui.chat.Names
import android.text.format.DateUtils
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.proto.ServerFrame
import com.hengxin.aioa.ui.chat.MarkdownText
import com.hengxin.aioa.ui.chat.MdColors
import com.hengxin.aioa.ui.chat.HtmlCard
import com.hengxin.aioa.ui.chat.FileCard
import com.hengxin.aioa.ui.chat.plainPreview
import com.hengxin.aioa.data.groupKey

private val CARD = RoundedCornerShape(14.dp)

/** 收藏: 按收藏时间倒序, 显示原消息的当前版本; 原消息没了只剩一句摘要。 */
@Composable
fun FavoritesPage(model: ChatModel, onBack: () -> Unit) {
    val dir = model.groups.directory
    val c = MaterialTheme.colorScheme
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    var forwarding by remember { mutableStateOf<ServerFrame.Msg?>(null) }
    val md = MdColors(c.onSurface, c.outline, c.primary, c.onSurface.copy(alpha = 0.08f))
    // 收藏按引用: 每次打开拉一次, 原消息改了 / 撤回了能看到 (带 ETag, 没变化不传正文)
    androidx.compose.runtime.LaunchedEffect(Unit) { dir.refreshFavorites() }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(6.dp), verticalAlignment = Alignment.CenterVertically) {
            BackButton(onBack)
            Text("收藏", fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
            Text("  ${dir.favorites.size} 条", fontSize = 13.sp, color = c.outline)
        }
        if (dir.favorites.isEmpty()) {
            Text("还没有收藏。在任意群里长按消息, 选 \"收藏\"。", Modifier.padding(24.dp), color = c.outline, fontSize = 13.sp)
        }
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(PAD), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(dir.favorites, key = { it.seq }) { f ->
                Column(Modifier.animateItem().fillMaxWidth().background(c.surfaceVariant.copy(alpha = 0.6f), CARD).padding(12.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        com.hengxin.aioa.ui.chat.SenderAvatar(f.msg, com.hengxin.aioa.ui.chat.MESSAGE_AVATAR)
                        Text(Names.of(f.msg), Modifier.padding(start = 8.dp).weight(1f), fontSize = 13.sp, fontWeight = FontWeight.Medium, maxLines = 1)
                        Text(DateUtils.formatDateTime(context, f.msg.ts, DateUtils.FORMAT_SHOW_DATE or DateUtils.FORMAT_SHOW_TIME or DateUtils.FORMAT_ABBREV_MONTH), fontSize = 11.sp, color = c.outline)
                    }
                    // 按引用显示: HTML 卡片, 附件, 转发与引用都和聊天里一致
                    f.msg.fwd?.let { Text("转发自 ${it.src}", fontSize = 12.sp, color = c.outline, modifier = Modifier.padding(top = 6.dp)) }
                    val html = f.msg.html
                    when {
                        f.gone -> Text("原消息已撤回或删除 · ${plainPreview(f.msg.text)}", Modifier.padding(top = 6.dp), fontSize = 13.sp, color = c.outline)
                        html != null -> HtmlCard(html, Modifier.padding(top = 6.dp))
                        else -> {
                            f.msg.file?.let { FileCard(it, c.onSurface, Modifier.padding(top = 6.dp)) }
                            if (f.msg.file == null || !f.msg.text.startsWith(FILE_TEXT_PREFIX)) MarkdownText(f.msg.text, md, Modifier.padding(top = 6.dp))
                        }
                    }
                    Row {
                        if (!f.gone) TextButton({ model.groups.openAt(f.msg.groupKey(), f.seq); onBack() }) { Text("定位") }
                        TextButton({ clipboard.setText(AnnotatedString(f.msg.text)) }) { Text("复制") }
                        TextButton({ forwarding = f.msg }) { Text("转发") }
                        TextButton({ dir.toggleFavorite(f.msg) }) { Text("取消收藏", color = c.error) }
                    }
                }
            }
        }
    }
    forwarding?.let { m -> ForwardDialog(model, m) { forwarding = null } }
}
