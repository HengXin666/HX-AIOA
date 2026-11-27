package com.hengxin.aioa.ui.groupinfo

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.data.MessageDb
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Glyph
import com.hengxin.aioa.kit.HomeRow
import com.hengxin.aioa.kit.HomeSection
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.pointerTap
import com.hengxin.aioa.proto.ServerFrame
import com.hengxin.aioa.ui.ChatModel
import com.hengxin.aioa.ui.ChatPage
import com.hengxin.aioa.ui.chat.plainPreview
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// 查找与群文件都只读本地库 (打开不请求); 更早的消息在群里上翻时才从云端补
private const val SCAN = 3000
private const val SHOWN = 200
private const val KB = 1024L
private val TIME = SimpleDateFormat("MM-dd HH:mm", Locale.CHINA)

/** 搜索框: 圆角矩形, 放大镜 + 输入。 */
@Composable
internal fun SearchBox(value: String, hint: String, onChange: (String) -> Unit) {
    val c = Aioa.colors
    Row(
        Modifier.padding(top = 14.dp).fillMaxWidth().height(40.dp).clip(RoundedCornerShape(12.dp)).background(c.surface).padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon("search", c.textSecondary, 17.dp)
        androidx.compose.foundation.layout.Box(Modifier.weight(1f)) {
            if (value.isEmpty()) Text(hint, c.textSecondary, 14)
            BasicTextField(value, onChange, Modifier.fillMaxWidth(), singleLine = true, textStyle = TextStyle(color = c.text, fontSize = 14.sp), cursorBrush = SolidColor(c.accent))
        }
        if (value.isNotEmpty()) Icon("x", c.textSecondary, 16.dp, Modifier.clip(RoundedCornerShape(6.dp)).pointerTap { onChange("") })
    }
}

private fun open(model: ChatModel, group: String, m: ServerFrame.Msg) {
    model.groups.page = ChatPage.CHAT
    model.groups.openAt(group, m.seq)
}

private fun sizeText(n: Long): String = if (n < KB * KB) "${(n / KB).coerceAtLeast(1)} KB" else "${"%.1f".format(n.toDouble() / KB / KB)} MB"

/** 查找记录 (files = false) 或群文件 (= 群历史里带附件的消息)。点一条回群里定位。 */
@Composable
internal fun GroupSearchPage(model: ChatModel, group: String, files: Boolean, onBack: () -> Unit) {
    val c = Aioa.colors
    val db = MessageDb.get(LocalContext.current)
    var q by remember { mutableStateOf("") }
    val all by produceState<List<ServerFrame.Msg>?>(null, group, files) {
        value = withContext(Dispatchers.IO) { db.inGroup(group, SCAN).filter { !files || it.file != null }.asReversed() }
    }
    val hits = remember(all, q) {
        val k = q.trim()
        all.orEmpty().filter { k.isEmpty() || (it.file?.name ?: it.text).contains(k, ignoreCase = true) }.take(SHOWN)
    }
    val title = if (files) "群文件" else "查找记录"
    GiPage(title, model.groups.directory.title(group), onBack) {
        SearchBox(q, if (files) "搜索文件名" else "搜索本群消息") { q = it }
        if (!files && q.isBlank()) {
            GiNote("输入关键字, 在本机已有的本群消息里查找")
            return@GiPage
        }
        HomeSection(if (files) "文件" else "结果", hits.size) {
            if (all == null) GiNote("正在读取...")
            else if (hits.isEmpty()) GiNote(if (files) "本机还没有这个群的文件" else "没找到, 更早的消息在群里上翻加载后再搜")
            hits.forEachIndexed { i, m ->
                val f = m.file
                if (f != null) HomeRow(f.name, divider = i > 0, trail = TIME.format(Date(m.ts)), lead = { Glyph("file", c.textSecondary) }, onClick = { open(model, group, m) },
                    end = { Text(sizeText(f.size), c.textSecondary, 11) })
                else HomeRow(plainPreview(m.text), divider = i > 0, trail = TIME.format(Date(m.ts)), lead = { Glyph("message-square", c.textSecondary) }, onClick = { open(model, group, m) })
            }
        }
    }
}

/** 精选: 收录目标 (日报 / 周报群) 一览, 点进去看; 消息长按 "收录" 到这些群。 */
@Composable
internal fun GroupPicksPage(model: ChatModel, group: String, onBack: () -> Unit) {
    val c = Aioa.colors
    val g = model.groups
    val digests = g.directory.digests()
    GiPage("精选", g.directory.title(group), onBack) {
        HomeSection("日报 / 周报群", digests.size) {
            if (digests.isEmpty()) GiNote("还没有日报 / 周报群。在某个群的设置里把群类型标成日报或周报, 这里的消息长按就能收录过去。")
            digests.forEachIndexed { i, m ->
                HomeRow(m.title ?: m.channel, com.hengxin.aioa.ui.chat.digestLabel(m.digest).orEmpty(), divider = i > 0, lead = { Glyph("sparkles", c.textSecondary) },
                    onClick = { g.page = ChatPage.CHAT; g.openGroup(m.channel) }, end = { Icon(ICON_NEXT, c.textSecondary, 14.dp) })
            }
        }
        GiNote("在群里长按一条消息, 选 \"精选\" 收录到上面的群。")
    }
}
