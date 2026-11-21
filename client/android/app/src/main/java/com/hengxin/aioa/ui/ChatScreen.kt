package com.hengxin.aioa.ui

import android.text.format.DateFormat
import android.text.format.DateUtils
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import com.hengxin.aioa.proto.ServerFrame

internal val PAD = 12.dp
private val BUBBLE_MINE = RoundedCornerShape(14.dp, 4.dp, 14.dp, 14.dp)
private val BUBBLE_OTHER = RoundedCornerShape(4.dp, 14.dp, 14.dp, 14.dp)
private val ONLINE = Color(0xFF34C759)
private val OFFLINE = Color(0xFFFF9500)

// 列表项: 时间分隔, 新消息分隔线, 气泡
private sealed interface Item {
    data class Time(val ts: Long) : Item
    data object Divider : Item
    data class Bubble(val msg: ServerFrame.Msg) : Item
}

@Composable
fun ChatScreen(model: ChatModel, onMetrics: () -> Unit, onSettings: () -> Unit) {
    Column(Modifier.fillMaxSize().safeDrawingPadding().imePadding()) {
        Header(model.online, onMetrics, onSettings)
        MessageList(model, Modifier.weight(1f))
        Composer(model::send)
    }
}

@Composable
private fun Header(online: Boolean, onMetrics: () -> Unit, onSettings: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(horizontal = PAD), verticalAlignment = Alignment.CenterVertically) {
        Text(stringResource(R.string.app_name), style = MaterialTheme.typography.titleMedium)
        Box(Modifier.padding(start = 8.dp).size(8.dp).background(if (online) ONLINE else OFFLINE, CircleShape))
        Text(
            stringResource(if (online) R.string.status_online else R.string.status_offline),
            Modifier.padding(start = 4.dp).weight(1f),
            fontSize = 12.sp,
            color = MaterialTheme.colorScheme.outline,
        )
        TextButton(onClick = onMetrics) { Text(stringResource(R.string.metrics)) }
        TextButton(onClick = onSettings) { Text(stringResource(R.string.settings)) }
    }
}

private fun buildRows(messages: List<ServerFrame.Msg>, dividerSeq: Long, isMine: (ServerFrame.Msg) -> Boolean): List<Item> {
    val rows = ArrayList<Item>(messages.size * 2)
    var prevTs = 0L
    var dividerPlaced = false
    for (msg in messages) {
        if (!dividerPlaced && msg.seq > dividerSeq && !isMine(msg)) {
            rows.add(Item.Divider)
            dividerPlaced = true
        }
        if (msg.ts - prevTs > Constants.TIME_GAP_MS) rows.add(Item.Time(msg.ts))
        prevTs = msg.ts
        rows.add(Item.Bubble(msg))
    }
    return rows
}

@Composable
private fun MessageList(model: ChatModel, modifier: Modifier) {
    val rows = buildRows(model.messages, model.dividerSeq, model::isMine)
    val state = rememberLazyListState()
    var positioned by remember(model.loaded) { mutableStateOf(false) }
    // 每次打开先停在 "以下是新消息", 之后来新消息滚到底
    LaunchedEffect(model.loaded, rows.size) {
        if (rows.isEmpty() || !model.loaded) return@LaunchedEffect
        val divider = rows.indexOf(Item.Divider)
        if (!positioned) {
            state.scrollToItem(if (divider >= 0) divider else rows.size - 1)
            positioned = true
        } else {
            state.animateScrollToItem(rows.size - 1)
        }
    }
    LazyColumn(modifier.fillMaxWidth().padding(horizontal = PAD), state, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        items(rows.size, key = { i -> rowKey(rows[i]) }) { i ->
            when (val row = rows[i]) {
                is Item.Time -> TimeLabel(row.ts)
                Item.Divider -> NewDivider()
                is Item.Bubble -> Bubble(row.msg, model.isMine(row.msg))
            }
        }
    }
}

private fun rowKey(row: Item): String = when (row) {
    is Item.Time -> "t${row.ts}"
    Item.Divider -> "divider"
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
private fun NewDivider() {
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        HorizontalDivider(Modifier.weight(1f), color = MaterialTheme.colorScheme.primary)
        Text(
            stringResource(R.string.new_messages),
            Modifier.padding(horizontal = 8.dp),
            fontSize = 11.sp,
            color = MaterialTheme.colorScheme.primary,
        )
        HorizontalDivider(Modifier.weight(1f), color = MaterialTheme.colorScheme.primary)
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
