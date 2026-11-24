package com.hengxin.aioa.ui.feed

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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Icon

private val SHAPE = RoundedCornerShape(16.dp)
private const val NEW = -1

/**
 * 群主编辑信息流标签: 顺序即优先级 (Agent 拿不准时取靠前的), 每个标签要写归类定义。
 * onSave(null) 表示恢复默认四类。
 */
@Composable
fun FeedTagsDialog(current: List<FeedTag>, onDismiss: () -> Unit, onSave: (List<FeedTag>?) -> Unit) {
    val c = Aioa.colors
    var tags by remember { mutableStateOf(current) }
    var editing by remember { mutableStateOf<Int?>(null) }
    Dialog(onDismiss, DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxWidth(0.92f).clip(SHAPE).background(c.surface).padding(16.dp)) {
            Text("信息流标签", color = c.text, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
            Text("Agent 只能用这里的标签, 拿不准时取排在前面的; 定义写清楚, 同一类东西才不会被分到不同标签。", Modifier.padding(top = 4.dp), color = c.textSecondary, fontSize = 12.sp, lineHeight = 17.sp)
            Column(Modifier.padding(top = 10.dp).heightIn(max = 420.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                tags.forEachIndexed { i, t ->
                    TagRow(t, i > 0, i < tags.lastIndex, { editing = i }, { tags = tags.swap(i, i - 1) }, { tags = tags.swap(i, i + 1) }) { tags = tags.filterIndexed { j, _ -> j != i } }
                }
                if (tags.size < MAX_TAGS) Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).clickable { editing = NEW }.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon("tag", c.accent, 16.dp)
                    Text("添加标签", Modifier.padding(start = 6.dp), color = c.accent, fontSize = 14.sp)
                }
            }
            Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                TextButton({ onSave(null); onDismiss() }) { Text("恢复默认", color = c.textSecondary) }
                Spacer(Modifier.weight(1f))
                TextButton(onDismiss) { Text("取消") }
                TextButton({ onSave(tags); onDismiss() }, enabled = tags.isNotEmpty() && tags != current) { Text("保存") }
            }
        }
    }
    editing?.let { i ->
        val old = tags.getOrNull(i)
        TagEditDialog(old, tags.filterIndexed { j, _ -> j != i }, { editing = null }) { t ->
            tags = if (old == null) tags + t else tags.mapIndexed { j, x -> if (j == i) t else x }
            editing = null
        }
    }
}

private fun <T> List<T>.swap(a: Int, b: Int): List<T> = toMutableList().also { val x = it[a]; it[a] = it[b]; it[b] = x }

@Composable
private fun TagRow(t: FeedTag, up: Boolean, down: Boolean, onEdit: () -> Unit, onUp: () -> Unit, onDown: () -> Unit, onDelete: () -> Unit) {
    val c = Aioa.colors
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(c.surfaceAlt).clickable(onClick = onEdit).padding(start = 10.dp, top = 8.dp, bottom = 8.dp, end = 2.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(10.dp).clip(CircleShape).background(tagColor(t.color)))
        Column(Modifier.weight(1f).padding(horizontal = 8.dp)) {
            Text("${t.label}  ${t.id}", color = c.text, fontSize = 14.sp, fontWeight = FontWeight.Medium)
            Text(t.desc.ifEmpty { "还没写定义" }, color = c.textSecondary, fontSize = 12.sp, lineHeight = 16.sp, maxLines = 2)
        }
        IconBtn("chevron-up", up, onUp)
        IconBtn("chevron-down", down, onDown)
        IconBtn("x", true, onDelete)
    }
}

@Composable
private fun IconBtn(icon: String, enabled: Boolean, onClick: () -> Unit) {
    val c = Aioa.colors
    Box(Modifier.size(32.dp).clip(CircleShape).clickable(enabled = enabled, onClick = onClick), contentAlignment = Alignment.Center) {
        Icon(icon, if (enabled) c.textSecondary else c.border, 16.dp)
    }
}

/** 新建或修改一个标签; id 建好后不能改 (旧推送和 Agent 都按它认)。 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TagEditDialog(old: FeedTag?, others: List<FeedTag>, onDismiss: () -> Unit, onDone: (FeedTag) -> Unit) {
    val c = Aioa.colors
    var id by remember { mutableStateOf(old?.id ?: "") }
    var label by remember { mutableStateOf(old?.label ?: "") }
    var desc by remember { mutableStateOf(old?.desc ?: "") }
    var color by remember { mutableStateOf(old?.color ?: FEED_COLORS.first()) }
    val err = when {
        !TAG_ID.matches(id) -> "id 用小写字母开头, 只含 a-z 0-9 -"
        others.any { it.id == id } -> "id 已存在"
        label.isBlank() -> "名称必填"
        others.any { it.label == label.trim() } -> "名称已存在"
        desc.isBlank() -> "定义必填: 写清楚什么东西归这一类"
        else -> null
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (old == null) "添加标签" else "修改标签") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(id, { id = it.lowercase().take(16) }, label = { Text("id (英文)") }, singleLine = true, enabled = old == null)
                OutlinedTextField(label, { label = it.take(MAX_TAG_LABEL) }, label = { Text("名称") }, singleLine = true)
                OutlinedTextField(desc, { desc = it.take(MAX_TAG_DESC) }, label = { Text("归类定义") }, minLines = 2)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    FEED_COLORS.forEach { k ->
                        val on = k == color
                        Box(Modifier.size(26.dp).clip(CircleShape).background(tagColor(k)).border(if (on) 3.dp else 0.dp, c.text, CircleShape).clickable { color = k })
                    }
                }
                err?.let { Text(it, color = c.danger, fontSize = 12.sp) }
            }
        },
        confirmButton = { TextButton({ onDone(FeedTag(id, label.trim(), desc.trim(), color)) }, enabled = err == null) { Text("确定") } },
        dismissButton = { TextButton(onDismiss) { Text("取消") } },
    )
}
