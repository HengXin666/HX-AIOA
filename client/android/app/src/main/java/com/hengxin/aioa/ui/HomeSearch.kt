package com.hengxin.aioa.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.hengxin.aioa.data.MessageDb
import com.hengxin.aioa.data.groupKey
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Glyph
import com.hengxin.aioa.kit.HomeRow
import com.hengxin.aioa.kit.HomeSection
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.pointerTap
import com.hengxin.aioa.proto.ServerFrame
import com.hengxin.aioa.ui.chat.GroupAvatar
import com.hengxin.aioa.ui.chat.SenderAvatar
import com.hengxin.aioa.ui.chat.plainPreview
import com.hengxin.aioa.ui.groupinfo.SearchBox
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// 侧栏搜索 (#139): 只读本机已有的群与消息, 打开不请求; 更早的消息要进群上翻后才搜得到
private const val SCAN = 5000
private const val GROUPS_SHOWN = 20
private const val MSGS_SHOWN = 60
// 和 HomeRow 行首图标一样大
private val FACE = 36.dp
private val TIME = SimpleDateFormat("MM-dd HH:mm", Locale.CHINA)

/** 搜索结果: 群 (按名字或 id) 与消息 (按正文或文件名), 都只取本机的。纯函数, 便于单测。 */
internal fun searchHome(q: String, groups: List<Pair<String, String>>, msgs: List<ServerFrame.Msg>): Pair<List<Pair<String, String>>, List<ServerFrame.Msg>> {
    val k = q.trim()
    if (k.isEmpty()) return emptyList<Pair<String, String>>() to emptyList()
    val g = groups.filter { (key, title) -> title.contains(k, ignoreCase = true) || key.contains(k, ignoreCase = true) }.take(GROUPS_SHOWN)
    val m = msgs.asReversed().filter { it.deleted == null && (it.file?.name ?: it.text).contains(k, ignoreCase = true) }.take(MSGS_SHOWN)
    return g to m
}

/** 侧栏 "搜索" 打开的全屏页: 点群进群, 点消息进群并定位到那条; 返回键关闭。 */
@Composable
fun HomeSearchPage(chat: ChatModel, onOpenGroup: (String) -> Unit, onOpenAt: (String, Long) -> Unit, onClose: () -> Unit) {
    val c = Aioa.colors
    val db = MessageDb.get(LocalContext.current)
    var q by rememberSaveable { mutableStateOf("") }
    val all by produceState<List<ServerFrame.Msg>?>(null) { value = withContext(Dispatchers.IO) { db.recent(SCAN) } }
    val dir = chat.groups.directory
    val groups = chat.groups.rows().map { it.key to (it.meta?.title?.takeIf { t -> t.isNotBlank() } ?: it.key) }
    val (gHits, mHits) = remember(q, all, groups) { searchHome(q, groups, all.orEmpty()) }
    Dialog(onClose, DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Column(Modifier.fillMaxSize().background(c.background).safeDrawingPadding().padding(horizontal = 14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Box(Modifier.padding(top = 14.dp).size(40.dp).clip(RoundedCornerShape(10.dp)).pointerTap(onClose), contentAlignment = Alignment.Center) {
                    Icon("chevron-left", c.text, 22.dp)
                }
                Box(Modifier.weight(1f)) { SearchBox(q, "搜索群, 会话与消息") { q = it } }
            }
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(bottom = 16.dp)) {
                if (q.isBlank()) {
                    Text("输入关键字, 在本机已有的群与消息里查找", c.textSecondary, 13, Modifier.padding(top = 18.dp, start = 4.dp), maxLines = 2)
                    return@Column
                }
                if (gHits.isNotEmpty()) HomeSection("群与会话", gHits.size) {
                    gHits.forEachIndexed { i, (key, title) ->
                        HomeRow(title, divider = i > 0, lead = { GroupAvatar(key, dir.metas[key], FACE) }, onClick = { onOpenGroup(key) })
                    }
                }
                HomeSection("消息", mHits.size) {
                    if (all == null) Text("正在读取...", c.textSecondary, 13, Modifier.padding(14.dp))
                    else if (mHits.isEmpty()) Text("没找到; 更早的消息进群上翻加载后再搜", c.textSecondary, 13, Modifier.padding(14.dp), maxLines = 2)
                    mHits.forEachIndexed { i, m ->
                        val key = m.groupKey()
                        HomeRow(
                            m.file?.name ?: plainPreview(m.text), dir.title(key), TIME.format(Date(m.ts)), divider = i > 0,
                            lead = { if (m.file != null) Glyph("file", c.textSecondary) else SenderAvatar(m, FACE) },
                            onClick = { onOpenAt(key, m.seq) },
                        )
                    }
                }
            }
        }
    }
}
