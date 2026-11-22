package com.hengxin.aioa.ui.settings

import android.annotation.SuppressLint
import android.content.Context
import android.widget.Toast
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.hengxin.aioa.Constants
import com.hengxin.aioa.R
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.ui.SettingsModel
import com.hengxin.aioa.ui.SystemActions
import com.hengxin.aioa.update.InstallPermission

// 与 Notifier 的通知 id 错开, 测试通知不覆盖真实未读汇总
private const val NOTIFY_ID_TEST = 99
private const val TEST_TEXT = "这是一条测试通知。能在顶部弹出, 锁屏可见, 有声音振动, 就说明设置好了。"

/** 通知设置: 权限状态, 进入 "新消息" 渠道设置 (MIUI 悬浮与锁屏通知引导), 测试通知。 */
@Composable
fun NotifyPage(actions: SystemActions, onBack: (() -> Unit)?) {
    val c = Aioa.colors
    val context = LocalContext.current
    val tick = rememberResumeTick()
    val on = remember(tick) { notificationsOn(context) }
    SettingsPageFrame(SettingsPage.NOTIFY.title, onBack) {
        SettingsGroup(TEXT_STATUS) { InfoRow("通知权限", if (on) TEXT_ON else TEXT_OFF, if (on) c.success else c.danger) }
        SettingsGroup("渠道", stringResource(R.string.notify_hint)) {
            ActionRow(stringResource(R.string.action_notify_settings), "bell", onClick = actions.notificationSettings)
        }
        SettingsGroup("测试", "发送前请确认上面的通知权限已开启。") {
            ActionRow("发送测试通知", "send") { postTest(context) }
        }
    }
}

@SuppressLint("MissingPermission")
private fun postTest(context: Context) {
    if (!notificationsOn(context)) {
        Toast.makeText(context, "通知权限未开启, 请先进入渠道设置打开。", Toast.LENGTH_LONG).show()
        return
    }
    val notification = NotificationCompat.Builder(context, Constants.CHANNEL_MESSAGE)
        .setSmallIcon(android.R.drawable.stat_notify_chat)
        .setContentTitle(context.getString(R.string.app_name))
        .setContentText(TEST_TEXT)
        .setStyle(NotificationCompat.BigTextStyle().bigText(TEST_TEXT))
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setAutoCancel(true)
        .build()
    runCatching { NotificationManagerCompat.from(context).notify(NOTIFY_ID_TEST, notification) }
}

/** 系统权限: 电池优化白名单, 自启动, 安装未知应用; 每次回到前台重读状态。 */
@Composable
fun SystemPage(actions: SystemActions, onBack: (() -> Unit)?) {
    val c = Aioa.colors
    val context = LocalContext.current
    val tick = rememberResumeTick()
    val battery = remember(tick) { batteryWhitelisted(context) }
    val install = remember(tick) { context.packageManager.canRequestPackageInstalls() }
    SettingsPageFrame(SettingsPage.SYSTEM.title, onBack) {
        SettingsGroup("后台保活", "红米等系统会在后台限制应用。加入电池优化白名单 (省电策略选 \"无限制\") 并允许自启动, 消息才能及时到达。") {
            ActionRow(stringResource(R.string.action_battery), "shield-check", if (battery) "已加入" else "未加入", onClick = actions.battery)
            RowDivider()
            ActionRow(stringResource(R.string.action_app_settings), "settings", onClick = actions.appSettings)
        }
        SettingsGroup("安装", "自动更新需要 \"安装未知应用\" 授权, 允许后返回本应用即可。") {
            ActionRow("安装未知应用", "hard-drive", if (install) TEXT_ALLOWED else TEXT_NOT_ALLOWED) {
                runCatching { context.startActivity(InstallPermission.intent(context)) }
            }
        }
        if (!battery) SettingsGroup { NoteRow("未加入白名单时, 后台长连接可能被系统断开。", c.warning) }
    }
}

/** 更新: 当前版本, 下载路由, 检查更新, 待安装版本说明, 历史更新说明。 */
@Composable
fun UpdatePage(model: SettingsModel, onNotes: () -> Unit, onBack: (() -> Unit)?) {
    val c = Aioa.colors
    SettingsPageFrame(SettingsPage.UPDATE.title, onBack) {
        SettingsGroup("版本") {
            InfoRow("当前版本", model.version)
            RowDivider(false)
            InfoRow("更新下载", model.updateRoute())
        }
        SettingsGroup {
            ActionRow(
                stringResource(R.string.action_check_update),
                ICON_REFRESH,
                if (model.updating) "检查中..." else "",
                enabled = !model.updating,
                onClick = model::checkUpdate,
            )
            if (model.updateText.isNotEmpty()) {
                RowDivider(false)
                NoteRow(model.updateText, c.textSecondary)
            }
        }
        model.pendingNotes?.let { note ->
            SettingsGroup(stringResource(R.string.pending_notes, note.versionName)) {
                note.lines.forEachIndexed { i, line ->
                    if (i > 0) RowDivider(false)
                    NoteRow("· $line")
                }
            }
        }
        SettingsGroup { NavRow("file-text", "更新说明", "历史公告", onClick = onNotes) }
    }
}
