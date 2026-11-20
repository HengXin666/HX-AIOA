package com.hengxin.aioa.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.R

private const val MAX_NODES_SHOWN = 30

class SystemActions(
    val battery: () -> Unit,
    val appSettings: () -> Unit,
    val notificationSettings: () -> Unit,
)

@Composable
fun SettingsScreen(model: SettingsModel, actions: SystemActions, onSaved: () -> Unit, onBack: (() -> Unit)?) {
    Column(
        Modifier.fillMaxSize().safeDrawingPadding().imePadding().verticalScroll(rememberScrollState()).padding(PAD),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.settings), Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
            if (onBack != null) TextButton(onClick = onBack) { Text(stringResource(R.string.action_back)) }
        }
        Section(stringResource(R.string.section_server))
        Field(model.server, { model.server = it }, R.string.config_server)
        Field(model.token, { model.token = it }, R.string.config_token, secret = true)

        Section(stringResource(R.string.section_proxy))
        Field(model.subscription, { model.subscription = it }, R.string.config_subscription)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.proxy_link), Modifier.weight(1f))
            Switch(checked = model.proxyLink, onCheckedChange = { model.proxyLink = it })
        }
        Button(onClick = { if (model.save()) onSaved() }) { Text(stringResource(R.string.action_save)) }
        ProxyPanel(model)

        Section(stringResource(R.string.section_update))
        Text(stringResource(R.string.current_version, model.version))
        Text(stringResource(R.string.update_route, model.updateRoute()), style = MaterialTheme.typography.bodySmall)
        OutlinedButton(onClick = model::checkUpdate, enabled = !model.updating) { Text(stringResource(R.string.action_check_update)) }
        if (model.updateText.isNotEmpty()) Text(model.updateText, style = MaterialTheme.typography.bodySmall)

        Section(stringResource(R.string.section_system))
        Text(stringResource(R.string.notify_hint), style = MaterialTheme.typography.bodySmall)
        OutlinedButton(onClick = actions.notificationSettings) { Text(stringResource(R.string.action_notify_settings)) }
        OutlinedButton(onClick = actions.battery) { Text(stringResource(R.string.action_battery)) }
        OutlinedButton(onClick = actions.appSettings) { Text(stringResource(R.string.action_app_settings)) }

        Section(stringResource(R.string.section_about))
        About(model.version)
    }
}

@Composable
private fun About(version: String) {
    Image(
        painterResource(R.drawable.about_art),
        contentDescription = stringResource(R.string.app_name),
        modifier = Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(16.dp)),
    )
    Text("${stringResource(R.string.app_name)} $version", style = MaterialTheme.typography.titleMedium)
    Text(stringResource(R.string.about_desc), style = MaterialTheme.typography.bodyMedium)
    Text(stringResource(R.string.about_repo), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
}

@Composable
private fun ProxyPanel(model: SettingsModel) {
    val view = model.proxy
    val hint = MaterialTheme.colorScheme.outline
    Text(view.summary, style = MaterialTheme.typography.bodyMedium)
    view.errors.forEach { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
    if (model.proxyMessage.isNotEmpty()) Text(model.proxyMessage, style = MaterialTheme.typography.bodySmall)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(onClick = model::optimize, enabled = view.running && !model.proxyBusy) {
            Text(stringResource(R.string.action_optimize))
        }
        OutlinedButton(onClick = model::refreshSubscription, enabled = view.running && !model.proxyBusy) {
            Text(stringResource(R.string.action_refresh_sub))
        }
        TextButton(onClick = model::refreshProxy) { Text(stringResource(R.string.action_refresh)) }
    }
    if (view.nodes.isEmpty()) return
    Text(stringResource(R.string.node_tap_hint), style = MaterialTheme.typography.bodySmall, color = hint)
    view.nodes.take(MAX_NODES_SHOWN).forEach { node ->
        val selected = node.name == view.current
        Row(
            Modifier.fillMaxWidth().clickable(enabled = !model.proxyBusy) { model.choose(node) }.padding(vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                (if (selected) "● " else "") + node.name,
                Modifier.weight(1f),
                color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
            )
            Text(node.type, Modifier.padding(horizontal = 8.dp), style = MaterialTheme.typography.bodySmall, color = hint)
            Text(if (node.delayMs > 0) "${node.delayMs} ms" else "--", style = MaterialTheme.typography.bodySmall)
        }
    }
    if (view.nodes.size > MAX_NODES_SHOWN) {
        Text(stringResource(R.string.node_more, view.nodes.size - MAX_NODES_SHOWN), style = MaterialTheme.typography.bodySmall, color = hint)
    }
}

@Composable
private fun Section(title: String) {
    HorizontalDivider()
    Text(title, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)
}

@Composable
private fun Field(value: String, onChange: (String) -> Unit, label: Int, secret: Boolean = false) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        modifier = Modifier.fillMaxWidth(),
        label = { Text(stringResource(label)) },
        singleLine = true,
        visualTransformation = if (secret) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
    )
}
