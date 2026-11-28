package com.hengxin.aioa.ui

import android.text.format.DateFormat
import android.text.format.DateUtils
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.data.Me
import com.hengxin.aioa.data.MessageDb
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.CountChip
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.SoftTag
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.hxPalette
import com.hengxin.aioa.kit.pointerTap
import com.hengxin.aioa.proto.Mentions
import com.hengxin.aioa.ui.chat.GroupAvatar
import com.hengxin.aioa.ui.chat.Names
import com.hengxin.aioa.ui.chat.digestLabel
import com.hengxin.aioa.ui.chat.plainPreview
import com.hengxin.aioa.ui.chat.tapHold

private const val ROW_AVATAR = 52
private val DIVIDER_INSET = 64.dp
private val CHIP_SHAPE = RoundedCornerShape(9.dp)

/** 列表里的一个会话; live 为正在输入 / 监听那一行, 有就顶替预览。 */
@Composable
internal fun ConvRow(r: GroupRowData, pinned: Boolean, divider: Boolean, live: String?, onOpen: () -> Unit, onLong: () -> Unit, modifier: Modifier = Modifier) {
    val c = Aioa.colors
    val pal = hxPalette()
    val meta = r.meta
    Column(modifier.fillMaxWidth().tapHold(onOpen, onLong)) {
        if (divider) Box(Modifier.padding(start = DIVIDER_INSET).fillMaxWidth().height(1.dp).background(c.border.copy(alpha = 0.5f)))
        Row(Modifier.padding(vertical = 11.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            GroupAvatar(r.key, meta, ROW_AVATAR.dp)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Box(Modifier.weight(1f, fill = false)) { Text(meta?.title ?: r.key, c.text, 16, weight = FontWeight.SemiBold) }
                        digestLabel(meta?.digest)?.let { SoftTag(it, pal.chart3) }
                        val agents = meta?.agents?.size ?: 0
                        if (agents > 0 && meta?.isDm != true) SoftTag("$agents Agent", pal.chart2)
                        if (r.muted) Icon("bell-off", c.textSecondary, 13.dp)
                    }
                    r.last?.let { Text(listTime(it.ts), c.textSecondary, 12) }
                }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    val last = r.last
                    val atMe = r.atMe
                    if (atMe) Text("[有人@我]", c.danger, 14)
                    val who = if (last == null || r.key == last.src || r.key == MessageDb.MEMO_GROUP || meta?.isDm == true) "" else "${Names.of(last)}: "
                    val preview = live ?: last?.let { who + plainPreview(it.text) } ?: "还没有消息"
                    Text(preview, if (live != null) pal.chart2 else c.textSecondary, 14, Modifier.weight(1f))
                    when {
                        r.unread > 0 -> CountChip(r.unread, strong = !r.muted)
                        pinned -> Icon("pin", c.textSecondary, 14.dp)
                    }
                }
            }
        }
    }
}

/** 域: 叠层头像 + "域 · n", 未读是域内合计 (免打扰的不算)。 */
@Composable
internal fun DomainRow(d: ListEntry.Domain, divider: Boolean, onOpen: () -> Unit, onLong: () -> Unit, modifier: Modifier = Modifier) {
    val c = Aioa.colors
    val tone = hxPalette().chart4
    Column(modifier.fillMaxWidth().tapHold(onOpen, onLong)) {
        if (divider) Box(Modifier.padding(start = DIVIDER_INSET).fillMaxWidth().height(1.dp).background(c.border.copy(alpha = 0.5f)))
        Row(Modifier.padding(vertical = 11.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            DomainAvatar(tone)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Box(Modifier.weight(1f, fill = false)) { Text(d.name, c.text, 16, weight = FontWeight.SemiBold) }
                        SoftTag("域 · ${d.rows.size}", tone)
                    }
                    d.latest?.last?.let { Text(listTime(it.ts), c.textSecondary, 12) }
                }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    val top = d.latest
                    val preview = when {
                        top == null -> "还没有群, 长按群可移进来"
                        top.last == null -> top.meta?.title ?: top.key
                        else -> "${top.meta?.title ?: top.key}: ${plainPreview(top.last.text)}"
                    }
                    Text(preview, c.textSecondary, 14, Modifier.weight(1f))
                    if (d.unread > 0) CountChip(d.unread, strong = true)
                }
            }
        }
    }
}

@Composable
private fun DomainAvatar(tone: Color) {
    val c = Aioa.colors
    Box(Modifier.size(ROW_AVATAR.dp)) {
        Box(Modifier.size(40.dp).offset(10.dp, 0.dp).clip(RoundedCornerShape(11.dp)).background(tone.copy(alpha = 0.12f)))
        Box(Modifier.size(44.dp).offset(0.dp, 8.dp).clip(RoundedCornerShape(12.dp)).background(c.surfaceAlt), contentAlignment = Alignment.Center) {
            Icon("layers", tone, 20.dp)
        }
    }
}

/** 置顶折叠条: "还有 n 个置顶已折叠" / "收起置顶"。 */
@Composable
internal fun FoldRow(f: ListEntry.Fold, onToggle: () -> Unit, modifier: Modifier = Modifier) {
    val c = Aioa.colors
    Row(
        modifier.fillMaxWidth().padding(vertical = 4.dp).clip(RoundedCornerShape(10.dp)).background(c.surface).pointerTap(onToggle).padding(horizontal = 12.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon("pin", c.textSecondary, 14.dp)
        Text(if (f.open) "收起置顶" else "还有 ${f.hidden} 个置顶已折叠", c.textSecondary, 13, Modifier.weight(1f))
        Icon(if (f.open) "chevron-up" else "chevron-down", c.textSecondary, 14.dp)
    }
}

/** 顶部一排标签筛选: 全部, 各个标签, 未读; 右端是 "+" 菜单。 */
@Composable
internal fun TagBar(tags: List<String>, selected: String?, unreadOnly: Boolean, unread: Int, onPick: (String?) -> Unit, onUnread: () -> Unit, onMenu: () -> Unit) {
    val c = Aioa.colors
    Row(Modifier.fillMaxWidth().padding(top = 10.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon("tag", c.textSecondary, 15.dp)
        LazyRow(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            item(key = "all") { TagChip("全部", selected == null && !unreadOnly) { onPick(null) } }
            tags.forEach { t -> item(key = "t:$t") { TagChip(t, selected == t) { onPick(t) } } }
            item(key = "unread") { TagChip(if (unread > 0) "未读 $unread" else "未读", unreadOnly, onUnread) }
        }
        Box(Modifier.size(32.dp).clip(RoundedCornerShape(9.dp)).background(c.surface).pointerTap(onMenu), contentAlignment = Alignment.Center) {
            Icon("plus", c.text, 16.dp)
        }
    }
}

@Composable
private fun TagChip(text: String, on: Boolean, onClick: () -> Unit) {
    val c = Aioa.colors
    Text(
        text, if (on) c.background else c.textSecondary, 13,
        Modifier.clip(CHIP_SHAPE).background(if (on) c.text else c.surface).pointerTap(onClick).padding(horizontal = 12.dp, vertical = 6.dp),
        weight = FontWeight.Medium,
    )
}

@Composable
internal fun listTime(ts: Long): String {
    val context = LocalContext.current
    return when {
        DateUtils.isToday(ts) -> DateFormat.getTimeFormat(context).format(ts)
        DateUtils.isToday(ts + DateUtils.DAY_IN_MILLIS) -> "昨天"
        else -> DateUtils.formatDateTime(context, ts, DateUtils.FORMAT_SHOW_DATE or DateUtils.FORMAT_ABBREV_MONTH)
    }
}

/** 列表的空状态与说明文字。 */
@Composable
internal fun ListNote(text: String) {
    Spacer(Modifier.height(8.dp))
    Text(text, Aioa.colors.textSecondary, 13, Modifier.padding(vertical = 16.dp), maxLines = 4)
}
