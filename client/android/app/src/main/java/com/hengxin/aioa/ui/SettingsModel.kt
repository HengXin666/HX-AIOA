package com.hengxin.aioa.ui

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.pm.PackageInfoCompat
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.hengxin.aioa.Constants
import com.hengxin.aioa.config.AppConfig
import com.hengxin.aioa.config.ConfigStore
import com.hengxin.aioa.link.LinkService
import com.hengxin.aioa.net.ProxyCore
import com.hengxin.aioa.net.ProxyStatus
import com.hengxin.aioa.net.ProxyStatusStore
import com.hengxin.aioa.update.Updater
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class SettingsModel(app: Application) : AndroidViewModel(app) {

    private val saved = ConfigStore.load(app)

    var server by mutableStateOf(saved?.server.orEmpty())
    var token by mutableStateOf(saved?.token.orEmpty())
    var subscription by mutableStateOf(saved?.subscription.orEmpty())
    var proxyLink by mutableStateOf(saved?.proxyLink ?: true)

    var proxyStatus by mutableStateOf<ProxyStatus?>(null)
        private set
    var updateText by mutableStateOf("")
        private set
    var updating by mutableStateOf(false)
        private set

    val coreAvailable = ProxyCore(app).available
    val version: String = app.packageManager.getPackageInfo(app.packageName, 0)
        .let { "${it.versionName} (${PackageInfoCompat.getLongVersionCode(it)})" }

    init {
        refreshProxy()
    }

    fun save(): Boolean {
        val config = AppConfig(server.trim(), token.trim(), subscription.trim(), proxyLink)
        if (!config.valid) return false
        val app = getApplication<Application>()
        ConfigStore.save(app, config)
        LinkService.start(app, Constants.ACTION_RELOAD)
        refreshProxyLater()
        return true
    }

    fun optimize() {
        LinkService.start(getApplication<Application>(), Constants.ACTION_OPTIMIZE)
        refreshProxyLater()
    }

    fun checkUpdate() {
        if (updating) return
        updating = true
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    Updater(getApplication<Application>()).update { text -> viewModelScope.launch { updateText = text } }
                }
            }
            result.exceptionOrNull()?.let { updateText = "检查失败: ${it.message}" }
            updating = false
        }
    }

    private fun refreshProxy() {
        viewModelScope.launch {
            proxyStatus = withContext(Dispatchers.IO) { ProxyStatusStore.load(getApplication<Application>()) }
        }
    }

    // 优选在 :link 进程里跑, 这里隔几秒读一次结果
    private fun refreshProxyLater() {
        viewModelScope.launch {
            repeat(REFRESH_TIMES) {
                delay(REFRESH_STEP_MS)
                refreshProxy()
            }
        }
    }

    private companion object {
        const val REFRESH_TIMES = 4
        const val REFRESH_STEP_MS = 3000L
    }
}
