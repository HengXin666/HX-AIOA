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
import com.hengxin.aioa.ui.chat.LetterAvatar
import com.hengxin.aioa.ui.chat.MarkdownText
import com.hengxin.aioa.ui.chat.MdColors

private val CARD = RoundedCornerShape(14.dp)

/** 收藏: 按收藏时间倒序, 存的是快照, 原消息被清理也还在。 */
@Composable
fun FavoritesPage(model: ChatModel, onBack: () -> Unit) {
    val dir = model.groups.directory
    val c = MaterialTheme.colorScheme
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    var forwarding by remember { mutableStateOf<ServerFrame.Msg?>(null) }
    val md = MdColors(c.onSurface, c.outline, c.primary, c.onSurface.copy(alpha = 0.08f))
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
                        LetterAvatar(Names.of(f.msg), 26.dp)
                        Text(Names.of(f.msg), Modifier.padding(start = 8.dp).weight(1f), fontSize = 13.sp, fontWeight = FontWeight.Medium, maxLines = 1)
                        Text(DateUtils.formatDateTime(context, f.msg.ts, DateUtils.FORMAT_SHOW_DATE or DateUtils.FORMAT_SHOW_TIME or DateUtils.FORMAT_ABBREV_MONTH), fontSize = 11.sp, color = c.outline)
                    }
                    MarkdownText(f.msg.text, md, Modifier.padding(top = 6.dp))
                    Row {
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
