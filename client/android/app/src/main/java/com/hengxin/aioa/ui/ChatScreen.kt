package com.hengxin.aioa.ui

import android.text.format.DateFormat
import android.text.format.DateUtils
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.Constants
import com.hengxin.aioa.R
import com.hengxin.aioa.data.MessageDb
import com.hengxin.aioa.proto.ServerFrame

internal val PAD = 12.dp
private val BUBBLE_MINE = RoundedCornerShape(14.dp, 4.dp, 14.dp, 14.dp)
private val BUBBLE_OTHER = RoundedCornerShape(4.dp, 14.dp, 14.dp, 14.dp)
private val ONLINE = Color(0xFF34C759)
private val OFFLINE = Color(0xFFFF9500)

// 列表项: 时间分隔与气泡
private sealed interface Item {
    data class Time(val ts: Long) : Item
    data class Bubble(val msg: ServerFrame.Msg) : Item
}

/** 消息栏: 未进群时是群列表 (按组收起), 点进去是该群的消息; 只有 "备忘" 群能发消息。 */
@Composable
fun ChatScreen(model: ChatModel) {
    val groups = model.groups
    val open = groups.open
    if (open == null) {
        GroupList(model)
        return
    }
    BackHandler { groups.close() }
    Column(Modifier.fillMaxSize()) {
        Header(open, model.online) { groups.close() }
        MessageList(groups.messages, model::isMine, Modifier.weight(1f))
        if (open == MessageDb.MEMO_GROUP) Composer(model::send)
    }
}

@Composable
internal fun Header(title: String, online: Boolean, onBack: (() -> Unit)? = null, action: (@Composable () -> Unit)? = null) {
    Row(Modifier.fillMaxWidth().padding(horizontal = PAD, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        if (onBack != null) {
            Text("‹", Modifier.clickable(onClick = onBack).padding(end = 10.dp), fontSize = 22.sp)
        }
        Text(title, style = MaterialTheme.typography.titleMedium, maxLines = 1)
        Box(Modifier.padding(start = 8.dp).size(8.dp).background(if (online) ONLINE else OFFLINE, CircleShape))
        Text(
            stringResource(if (online) R.string.status_online else R.string.status_offline),
            Modifier.padding(start = 4.dp).weight(1f),
            fontSize = 12.sp,
            color = MaterialTheme.colorScheme.outline,
        )
        action?.invoke()
    }
}

private fun buildRows(messages: List<ServerFrame.Msg>): List<Item> {
    val rows = ArrayList<Item>(messages.size * 2)
    var prevTs = 0L
    for (msg in messages) {
        if (msg.ts - prevTs > Constants.TIME_GAP_MS) rows.add(Item.Time(msg.ts))
        prevTs = msg.ts
        rows.add(Item.Bubble(msg))
    }
    return rows
}

@Composable
private fun MessageList(messages: List<ServerFrame.Msg>, isMine: (ServerFrame.Msg) -> Boolean, modifier: Modifier) {
    val rows = buildRows(messages)
    val state = rememberLazyListState()
    LaunchedEffect(rows.size) { if (rows.isNotEmpty()) state.scrollToItem(rows.size - 1) }
    LazyColumn(modifier.fillMaxWidth().padding(horizontal = PAD), state, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        items(rows.size, key = { i -> rowKey(rows[i]) }) { i ->
            when (val row = rows[i]) {
                is Item.Time -> TimeLabel(row.ts)
                is Item.Bubble -> Bubble(row.msg, isMine(row.msg))
            }
        }
    }
}

private fun rowKey(row: Item): String = when (row) {
    is Item.Time -> "t${row.ts}"
    is Item.Bubble -> "m${row.msg.seq}"
}

@Composable
private fun TimeLabel(ts: Long) {
    val context = LocalContext.current
    val text = if (DateUtils.isToday(ts)) {
        DateFormat.getTimeFormat(context).format(ts)
    } else {
        DateUtils.formatDateTime(context, ts, DateUtils.FORMAT_SHOW_DATE or DateUtils.FORMAT_SHOW_TIME)
    }
    Box(Modifier.fillMaxWidth().padding(vertical = 4.dp), contentAlignment = Alignment.Center) {
        Text(text, fontSize = 11.sp, color = MaterialTheme.colorScheme.outline)
    }
}

@Composable
private fun Bubble(msg: ServerFrame.Msg, mine: Boolean) {
    val colors = MaterialTheme.colorScheme
    Column(
        Modifier.fillMaxWidth(),
        horizontalAlignment = if (mine) Alignment.End else Alignment.Start,
    ) {
        if (!mine) Text(msg.src, fontSize = 11.sp, color = colors.outline, modifier = Modifier.padding(start = 4.dp, bottom = 2.dp))
        Box(
            Modifier.widthIn(max = 300.dp)
                .background(if (mine) colors.primaryContainer else colors.surfaceVariant, if (mine) BUBBLE_MINE else BUBBLE_OTHER)
                .padding(horizontal = PAD, vertical = 8.dp),
        ) {
            Text(msg.text, color = if (mine) colors.onPrimaryContainer else colors.onSurfaceVariant)
        }
    }
}

@Composable
private fun Composer(onSend: (String) -> Boolean) {
    var text by remember { mutableStateOf("") }
    Row(Modifier.fillMaxWidth().padding(PAD), verticalAlignment = Alignment.CenterVertically) {
        OutlinedTextField(
            value = text,
            onValueChange = { text = it },
            modifier = Modifier.weight(1f),
            placeholder = { Text(stringResource(R.string.input_hint)) },
            maxLines = 4,
        )
        Button(onClick = { if (onSend(text)) text = "" }, Modifier.padding(start = 8.dp), enabled = text.isNotBlank()) {
            Text(stringResource(R.string.action_send))
        }
    }
}
