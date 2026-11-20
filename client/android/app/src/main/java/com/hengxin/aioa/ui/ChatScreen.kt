package com.hengxin.aioa.ui

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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.R
import com.hengxin.aioa.proto.ServerFrame

private val BUBBLE_SHAPE = RoundedCornerShape(12.dp)
private val PAD = 12.dp

@Composable
fun ChatScreen(
    model: ChatModel,
    onBattery: () -> Unit,
    onAppSettings: () -> Unit,
) {
    Column(Modifier.fillMaxSize().safeDrawingPadding().imePadding()) {
        Header(model.online, onBattery, onAppSettings)
        if (!model.configured) {
            ConfigForm(model::saveConfig)
            return@Column
        }
        MessageList(model.messages, model.device, Modifier.weight(1f))
        Composer(model::send)
    }
}

@Composable
private fun Header(online: Boolean, onBattery: () -> Unit, onAppSettings: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(horizontal = PAD), verticalAlignment = Alignment.CenterVertically) {
        Text(stringResource(R.string.app_name), style = MaterialTheme.typography.titleMedium)
        Text(
            stringResource(if (online) R.string.status_online else R.string.status_offline),
            Modifier.padding(start = 8.dp).weight(1f),
            fontSize = 12.sp,
        )
        TextButton(onClick = onBattery) { Text(stringResource(R.string.action_battery)) }
        TextButton(onClick = onAppSettings) { Text(stringResource(R.string.action_app_settings)) }
    }
}

@Composable
private fun MessageList(messages: List<ServerFrame.Msg>, me: String, modifier: Modifier) {
    val state = rememberLazyListState()
    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) state.animateScrollToItem(messages.size - 1)
    }
    LazyColumn(modifier.fillMaxWidth().padding(horizontal = PAD), state, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        items(messages, key = { it.seq }) { msg -> Bubble(msg, msg.src == me) }
    }
}

@Composable
private fun Bubble(msg: ServerFrame.Msg, mine: Boolean) {
    Box(Modifier.fillMaxWidth(), contentAlignment = if (mine) Alignment.CenterEnd else Alignment.CenterStart) {
        Column(
            Modifier.widthIn(max = 320.dp)
                .background(MaterialTheme.colorScheme.surfaceVariant, BUBBLE_SHAPE)
                .padding(horizontal = PAD, vertical = 8.dp),
        ) {
            Text(msg.text)
            Text("#${msg.seq} · ${msg.src}", fontSize = 11.sp, color = MaterialTheme.colorScheme.outline)
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
            singleLine = true,
        )
        Button(onClick = { if (onSend(text)) text = "" }, Modifier.padding(start = 8.dp)) {
            Text(stringResource(R.string.action_send))
        }
    }
}

@Composable
private fun ConfigForm(onSave: (String, String) -> Boolean) {
    var server by remember { mutableStateOf("") }
    var token by remember { mutableStateOf("") }
    Column(Modifier.fillMaxWidth().padding(PAD), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(stringResource(R.string.no_config))
        OutlinedTextField(
            value = server,
            onValueChange = { server = it },
            modifier = Modifier.fillMaxWidth(),
            label = { Text(stringResource(R.string.config_server)) },
            singleLine = true,
        )
        OutlinedTextField(
            value = token,
            onValueChange = { token = it },
            modifier = Modifier.fillMaxWidth(),
            label = { Text(stringResource(R.string.config_token)) },
            visualTransformation = PasswordVisualTransformation(),
            singleLine = true,
        )
        Button(onClick = { onSave(server, token) }) { Text(stringResource(R.string.action_save)) }
    }
}
