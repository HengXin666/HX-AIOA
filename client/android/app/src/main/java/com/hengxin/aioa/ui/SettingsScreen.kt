package com.hengxin.aioa.ui

import android.text.format.DateUtils
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.R

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
        Text(proxyLine(model), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
        Button(onClick = { if (model.save()) onSaved() }) { Text(stringResource(R.string.action_save)) }
        OutlinedButton(onClick = model::optimize, enabled = model.subscription.isNotBlank()) {
            Text(stringResource(R.string.action_optimize))
        }

        Section(stringResource(R.string.section_update))
        Text(stringResource(R.string.current_version, model.version))
        OutlinedButton(onClick = model::checkUpdate, enabled = !model.updating) { Text(stringResource(R.string.action_check_update)) }
        if (model.updateText.isNotEmpty()) Text(model.updateText, style = MaterialTheme.typography.bodySmall)

        Section(stringResource(R.string.section_system))
        Text(stringResource(R.string.notify_hint), style = MaterialTheme.typography.bodySmall)
        OutlinedButton(onClick = actions.notificationSettings) { Text(stringResource(R.string.action_notify_settings)) }
        OutlinedButton(onClick = actions.battery) { Text(stringResource(R.string.action_battery)) }
        OutlinedButton(onClick = actions.appSettings) { Text(stringResource(R.string.action_app_settings)) }
    }
}

@Composable
private fun proxyLine(model: SettingsModel): String {
    if (!model.coreAvailable) return stringResource(R.string.proxy_core_missing)
    val status = model.proxyStatus ?: return stringResource(R.string.proxy_idle)
    val ago = DateUtils.getRelativeTimeSpanString(status.at).toString()
    return stringResource(R.string.proxy_status, status.node, status.delayMs, status.nodes, ago)
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
