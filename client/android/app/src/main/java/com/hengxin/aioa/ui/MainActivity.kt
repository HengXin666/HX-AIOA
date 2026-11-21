package com.hengxin.aioa.ui

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import com.hengxin.aioa.Constants
import com.hengxin.aioa.R
import com.hengxin.aioa.update.Updater
import com.hengxin.aioa.link.LinkService

class MainActivity : ComponentActivity() {

    private val chat: ChatModel by viewModels()
    private val settings: SettingsModel by viewModels()

    private val notifyPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            notifyPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        if (chat.configured) LinkService.start(this)
        val actions = SystemActions(::requestBatteryWhitelist, ::openAppSettings, ::openNotificationSettings)
        setContent {
            val scheme = if (isSystemInDarkTheme()) darkColorScheme() else lightColorScheme()
            MaterialTheme(colorScheme = scheme) {
                Surface {
                    var showSettings by rememberSaveable { mutableStateOf(false) }
                    var showMetrics by rememberSaveable { mutableStateOf(false) }
                    if (chat.configured && showMetrics && !showSettings) {
                        MetricsScreen(chat.metrics) { showMetrics = false }
                    } else if (!chat.configured || showSettings) {
                        BackHandler(enabled = chat.configured) { showSettings = false }
                        SettingsScreen(
                            settings,
                            actions,
                            onSaved = {
                                // 首次配置保存后进入聊天; 之后的修改留在设置页, 方便看代理状态
                                val first = !chat.configured
                                chat.onConfigSaved()
                                if (first) chat.resume()
                            },
                            onBack = if (chat.configured) ({ showSettings = false }) else null,
                        )
                    } else {
                        ChatScreen(chat, onMetrics = { showMetrics = true }) { showSettings = true }
                    }
                }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        chat.resume()
        resumePendingUpdate()
    }

    // 从 "安装未知应用" 授权页回来后, 用已下载的安装包继续安装
    private fun resumePendingUpdate() {
        val context = applicationContext
        Thread {
            if (Updater.takePermissionResume(context)) runCatching { Updater(context).update(foreground = true) { } }
        }.start()
    }

    override fun onStop() {
        chat.pause()
        super.onStop()
    }

    // 已在白名单时系统请求弹窗不会再出现, 所以改为打开红米的省电策略页
    @SuppressLint("BatteryLife")
    private fun requestBatteryWhitelist() {
        val power = getSystemService(PowerManager::class.java)
        if (!power.isIgnoringBatteryOptimizations(packageName)) {
            val request = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                .setData(Uri.fromParts(SCHEME_PACKAGE, packageName, null))
            if (tryStart(request)) return
        }
        val miui = Intent().setClassName(MIUI_POWER_PKG, MIUI_POWER_ACTIVITY)
            .putExtra("package_name", packageName)
            .putExtra("package_label", getString(R.string.app_name))
        val opened = tryStart(miui) || tryStart(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) || tryStart(appDetails())
        val tip = if (opened) R.string.battery_already else R.string.battery_open_failed
        Toast.makeText(this, tip, Toast.LENGTH_LONG).show()
    }

    // 先试红米的自启动管理页, 不行再退回应用详情页
    private fun openAppSettings() {
        tryStart(Intent().setClassName(MIUI_SECURITY_PKG, MIUI_AUTOSTART_ACTIVITY)) || tryStart(appDetails())
    }

    private fun appDetails() = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
        .setData(Uri.fromParts(SCHEME_PACKAGE, packageName, null))

    private fun tryStart(intent: Intent): Boolean = runCatching { startActivity(intent) }.isSuccess

    // MIUI 默认关闭 "悬浮通知" 和 "锁屏通知", 代码无法打开, 只能直达渠道设置页让用户手动开
    private fun openNotificationSettings() {
        val intent = Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
            .putExtra(Settings.EXTRA_CHANNEL_ID, Constants.CHANNEL_MESSAGE)
        runCatching { startActivity(intent) }.onFailure {
            startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName))
        }
    }

    private companion object {
        const val SCHEME_PACKAGE = "package"
        const val MIUI_POWER_PKG = "com.miui.powerkeeper"
        const val MIUI_POWER_ACTIVITY = "com.miui.powerkeeper.ui.HiddenAppsConfigActivity"
        const val MIUI_SECURITY_PKG = "com.miui.securitycenter"
        const val MIUI_AUTOSTART_ACTIVITY = "com.miui.permcenter.autostart.AutoStartManagementActivity"
    }
}
