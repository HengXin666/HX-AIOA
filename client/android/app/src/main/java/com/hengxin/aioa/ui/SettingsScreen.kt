package com.hengxin.aioa.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import com.hengxin.aioa.R
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.ui.settings.NoteRow
import com.hengxin.aioa.ui.settings.PrimaryAction
import com.hengxin.aioa.ui.settings.ProxyFields
import com.hengxin.aioa.ui.settings.ServerFields
import com.hengxin.aioa.ui.settings.SettingsGroup
import com.hengxin.aioa.ui.settings.SettingsPageFrame

/** 打开系统设置页的入口, 由 Activity 提供 (需要 startActivity 与 MIUI 专用页面)。 */
class SystemActions(
    val battery: () -> Unit,
    val appSettings: () -> Unit,
    val notificationSettings: () -> Unit,
)

/** 首次配置: 服务端与可选订阅, 保存后进入主界面; 其余设置都在 "我的" 里。 */
@Composable
fun SettingsScreen(model: SettingsModel, onSaved: () -> Unit) {
    Box(Modifier.fillMaxSize().safeDrawingPadding()) {
        SettingsPageFrame("连接服务端", null) {
            SettingsGroup { NoteRow("填写服务端地址和令牌即可开始接收消息。通知, 电池白名单, 代理节点等稍后在 \"我的\" 里设置。", Aioa.colors.textSecondary) }
            ServerFields(model, null, onSaved, withSave = false)
            ProxyFields(model, onSaved, withSave = false)
            PrimaryAction(stringResource(R.string.action_save)) { if (model.save()) onSaved() }
        }
    }
}
