package com.hengxin.aioa.ui

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import com.hengxin.aioa.link.LinkService

class MainActivity : ComponentActivity() {

    private val model: ChatModel by viewModels()

    private val notifyPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            notifyPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        if (model.configured) LinkService.start(this)
        setContent {
            MaterialTheme {
                Surface {
                    ChatScreen(model, ::requestBatteryWhitelist, ::openAppSettings)
                }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        model.resume()
    }

    override fun onStop() {
        model.pause()
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

    private companion object {
        const val SCHEME_PACKAGE = "package"
    }
}
