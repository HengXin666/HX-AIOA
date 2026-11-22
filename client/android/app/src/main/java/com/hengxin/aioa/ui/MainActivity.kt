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
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.hengxin.aioa.Constants
import com.hengxin.aioa.R
import com.hengxin.aioa.config.AppearanceStore
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.AioaTheme
import com.hengxin.aioa.update.ReleaseNote
import com.hengxin.aioa.update.ReleaseNotes
import com.hengxin.aioa.update.Updater
import com.hengxin.aioa.link.LinkService

class MainActivity : ComponentActivity() {

    private val chat: ChatModel by viewModels()
    private val settings: SettingsModel by viewModels()

    // 非空时显示更新公告抽屉
    private var notes by mutableStateOf<List<ReleaseNote>?>(null)

    private val notifyPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            notifyPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        if (chat.configured) LinkService.start(this)
        announce()
        val actions = SystemActions(::requestBatteryWhitelist, ::openAppSettings, ::openNotificationSettings)
        setContent {
            var prefs by remember { mutableStateOf(AppearanceStore.load(this)) }
            val appearance = prefs.resolve(isSystemInDarkTheme())
            AioaTheme(appearance) {
                MaterialTheme(colorScheme = materialScheme(Aioa.colors, appearance.dark)) {
                    Surface {
                        if (!chat.configured) {
                            // 首次配置保存后进入主界面; 之后的修改都在 "我的" 里
                            SettingsScreen(settings) {
                                chat.onConfigSaved()
                                chat.resume()
                            }
                        } else {
                            Shell(chat, { settings }, actions, prefs, { next ->
                                prefs = next
                                AppearanceStore.save(this, next)
                            }, ::showHistory)
                        }
                        notes?.let { NotesSheet(it, ::closeNotes) }
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

    // 新版本首次启动弹一次更新公告; 本地没有说明时会拉一次 update.json, 放后台线程
    private fun announce() {
        val context = applicationContext
        Thread {
            val note = runCatching { Updater(context).announcement() }.getOrNull() ?: return@Thread
            runOnUiThread { notes = listOf(note) }
        }.start()
    }

    private fun showHistory() {
        notes = ReleaseNotes.history(this).take(HISTORY_SHOWN)
    }

    private fun closeNotes() {
        notes = null
        val context = applicationContext
        Thread { runCatching { ReleaseNotes.markShown(context, Updater(context).currentVersion()) } }.start()
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
        const val HISTORY_SHOWN = 5
        const val MIUI_POWER_PKG = "com.miui.powerkeeper"
        const val MIUI_POWER_ACTIVITY = "com.miui.powerkeeper.ui.HiddenAppsConfigActivity"
        const val MIUI_SECURITY_PKG = "com.miui.securitycenter"
        const val MIUI_AUTOSTART_ACTIVITY = "com.miui.permcenter.autostart.AutoStartManagementActivity"
    }
}
