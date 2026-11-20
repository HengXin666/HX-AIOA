package com.hengxin.aioa.ui

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
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
                    if (!chat.configured || showSettings) {
                        BackHandler(enabled = chat.configured) { showSettings = false }
                        SettingsScreen(
                            settings,
                            actions,
                            onSaved = {
                                chat.onConfigSaved()
                                showSettings = false
                                chat.resume()
                            },
                            onBack = if (chat.configured) ({ showSettings = false }) else null,
                        )
                    } else {
                        ChatScreen(chat) { showSettings = true }
                    }
                }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        chat.resume()
    }

    override fun onStop() {
        chat.pause()
        super.onStop()
    }

    @SuppressLint("BatteryLife")
    private fun requestBatteryWhitelist() {
        val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
            .setData(Uri.fromParts(SCHEME_PACKAGE, packageName, null))
        runCatching { startActivity(intent) }
    }

    // 红米的自启动开关在应用详情页里, 没有稳定的直达入口
    private fun openAppSettings() {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
            .setData(Uri.fromParts(SCHEME_PACKAGE, packageName, null))
        runCatching { startActivity(intent) }
    }

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
    }
}
