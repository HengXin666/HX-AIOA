package com.hengxin.aioa.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import com.hengxin.aioa.R
import com.hengxin.aioa.config.Auth
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.ui.settings.InputRow
import com.hengxin.aioa.ui.settings.NoteRow
import com.hengxin.aioa.ui.settings.PrimaryAction
import com.hengxin.aioa.ui.settings.ProxyFields
import com.hengxin.aioa.ui.settings.RowDivider
import com.hengxin.aioa.ui.settings.ServerFields
import com.hengxin.aioa.ui.settings.SettingsGroup
import com.hengxin.aioa.ui.settings.SettingsPageFrame
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** 打开系统设置页的入口, 由 Activity 提供 (需要 startActivity 与 MIUI 专用页面)。 */
class SystemActions(
    val battery: () -> Unit,
    val appSettings: () -> Unit,
    val notificationSettings: () -> Unit,
)

/** 首次配置: 服务端, 账号登录与可选订阅, 保存后进入主界面; 其余设置都在 "我的" 里。 */
@Composable
fun SettingsScreen(model: SettingsModel, onSaved: () -> Unit) {
    val context = LocalContext.current.applicationContext
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var invite by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }
    Box(Modifier.fillMaxSize().safeDrawingPadding()) {
        SettingsPageFrame("连接服务端", null) {
            SettingsGroup { NoteRow("填写服务端地址, 再用账号登录即可开始接收消息。通知, 电池白名单, 代理节点等稍后在 \"我的\" 里设置。", Aioa.colors.textSecondary) }
            ServerFields(model, null, onSaved, withSave = false)
            SettingsGroup("账号登录", "消息按账号隔离, 必须登录。新同学填管理员给的邀请码即注册新账号。") {
                InputRow("用户名", name, "例如 Heng_Xin") { name = it }
                RowDivider(false)
                InputRow("密码", password, "至少 8 位", secret = true) { password = it }
                RowDivider(false)
                InputRow("邀请码", invite, "已有账号留空") { invite = it }
            }
            ProxyFields(model, onSaved, withSave = false)
            if (message.isNotEmpty()) SettingsGroup { NoteRow(message, Aioa.colors.danger) }
            PrimaryAction(if (busy) "登录中..." else stringResource(R.string.action_save), enabled = !busy) {
                if (name.isBlank() || password.isEmpty()) {
                    message = "请填写用户名和密码"
                    return@PrimaryAction
                }
                busy = true
                scope.launch {
                    val r = withContext(Dispatchers.IO) {
                        if (invite.isBlank()) Auth.login(context, model.server, name, password)
                        else Auth.join(context, model.server, invite, name, password)
                    }
                    busy = false
                    if (r.session == null) message = r.error ?: "登录失败"
                    else if (model.save()) onSaved()
                }
            }
        }
    }
}
