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
import com.hengxin.aioa.config.Auth
import com.hengxin.aioa.config.ConfigStore
import com.hengxin.aioa.link.LinkLog
import com.hengxin.aioa.link.LinkService
import com.hengxin.aioa.link.LinkStats
import com.hengxin.aioa.net.NodeInfo
import com.hengxin.aioa.net.NodeOptimizer
import com.hengxin.aioa.net.ProxyController
import com.hengxin.aioa.net.ProxyCore
import com.hengxin.aioa.net.ProxyDemand
import com.hengxin.aioa.net.Subscription
import com.hengxin.aioa.update.ReleaseNote
import com.hengxin.aioa.update.ReleaseNotes
import com.hengxin.aioa.update.Updater
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class ProxyView(
    val running: Boolean = false,
    val summary: String = "",
    val current: String? = null,
    val nodes: List<NodeInfo> = emptyList(),
    val errors: List<String> = emptyList(),
    val subStatus: String = "",
    val linkLog: List<String> = emptyList(),
)

class SettingsModel(app: Application) : AndroidViewModel(app) {

    private val saved = ConfigStore.load(app)

    var server by mutableStateOf(saved?.server.orEmpty())
    var token by mutableStateOf(saved?.token.orEmpty())
    var subscription by mutableStateOf(saved?.subscription.orEmpty())
    var proxyLink by mutableStateOf(saved?.proxyLink ?: true)

    var proxy by mutableStateOf(ProxyView())
        private set
    var proxyMessage by mutableStateOf("")
        private set
    var proxyBusy by mutableStateOf(false)
        private set
    var updateText by mutableStateOf("")
        private set
    var updating by mutableStateOf(false)
        private set
    // 检查更新发现的待安装版本说明
    var pendingNotes by mutableStateOf<ReleaseNote?>(null)
        private set

    private val app get() = getApplication<Application>()
    private val coreAvailable = ProxyCore(app).available
    val version: String = app.packageManager.getPackageInfo(app.packageName, 0)
        .let { "${it.versionName} (${PackageInfoCompat.getLongVersionCode(it)})" }

    init {
        refreshProxy()
    }

    fun save(): Boolean {
        if (proxyBusy) return false
        val config = AppConfig(server.trim(), token.trim(), subscription.trim(), proxyLink)
        if (!config.valid && !(config.server.isNotBlank() && Auth.signedIn(app))) {
            proxyMessage = "服务端地址不能为空, 令牌和账号登录至少要有一个"
            return false
        }
        ConfigStore.save(app, config)
        LinkService.start(app, Constants.ACTION_RELOAD)
        proxyMessage = if (config.proxyEnabled) "已保存, 正在启动代理内核..." else "已保存, 当前为直连"
        pollProxy()
        return true
    }

    fun optimize() = proxyJob("正在测速全部节点...") {
        val result = NodeOptimizer.run(app)
        when {
            result == null -> "测速失败: 内核未运行, 或全部节点超时"
            result.switched -> "已切换到 ${result.node}, ${result.delayMs} ms, ${result.alive}/${result.total} 个节点可用"
            else -> "保持 ${result.node}, ${result.delayMs} ms, ${result.alive}/${result.total} 个节点可用"
        }
    }

    fun choose(node: NodeInfo) = proxyJob("切换中...") {
        if (NodeOptimizer.choose(app, node)) "已手动切换到 ${node.name}" else "切换失败"
    }

    fun refreshSubscription() = proxyJob("正在重新下载订阅...") {
        val url = ConfigStore.load(app)?.subscription.orEmpty()
        if (url.isBlank()) return@proxyJob "未配置订阅"
        val status = Subscription.download(app, url)
        if (!status.ok) return@proxyJob status.text
        if (ProxyController(app).refreshSubscription()) status.text else "${status.text}, 但内核重读失败, 看下方报错"
    }

    // 打开设置页或手动刷新时按需拉起内核, 不用之后由 :link 空闲停掉
    fun refreshProxy() {
        viewModelScope.launch {
            proxy = withContext(Dispatchers.IO) { loadProxy() }
            if (!proxy.running && withContext(Dispatchers.IO) { ProxyDemand.ensure(app) }) {
                proxy = withContext(Dispatchers.IO) { loadProxy() }
            }
        }
    }

    // 更新下载与长连接共用 Net 的判断: 内核在跑就走代理
    fun updateRoute(): String = if (proxy.running && proxy.current != null) "经由代理节点 ${proxy.current}" else "直连"

    fun checkUpdate() {
        if (updating) return
        updating = true
        updateText = "正在检查, ${updateRoute()}..."
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching { Updater(app).update(foreground = true) { text -> viewModelScope.launch { updateText = text } } }
            }
            result.exceptionOrNull()?.let { updateText = "检查失败 (${updateRoute()}): ${it.message}" }
            pendingNotes = withContext(Dispatchers.IO) {
                val current = Updater(app).currentVersion()
                ReleaseNotes.history(app).firstOrNull { it.versionCode > current }
            }
            updating = false
        }
    }

    private fun proxyJob(start: String, block: () -> String) {
        if (proxyBusy) return
        proxyBusy = true
        proxyMessage = start
        viewModelScope.launch {
            proxyMessage = withContext(Dispatchers.IO) {
                ProxyDemand.ensure(app)
                runCatching(block).getOrElse { "出错: ${it.message}" }
            }
            proxy = withContext(Dispatchers.IO) { loadProxy() }
            proxyBusy = false
        }
    }

    // 内核在 :link 进程里重启并拉取订阅, 这里逐秒显示进度, 结束时给出明确结论
    private fun pollProxy() {
        proxyBusy = true
        viewModelScope.launch {
            try { pollSteps() } finally { proxyBusy = false }
        }
    }

    private suspend fun pollSteps() {
        val pollStart = System.currentTimeMillis()
        run {
            for (step in 1..POLL_TIMES) {
                delay(POLL_STEP_MS)
                proxy = withContext(Dispatchers.IO) { loadProxy() }
                if (proxy.nodes.isNotEmpty()) {
                    proxyMessage = "订阅解析出 ${proxy.nodes.size} 个节点, 当前 ${proxy.current ?: "未选择"}"
                    return
                }
                val sub = withContext(Dispatchers.IO) { Subscription.status(app) }
                if (sub != null && !sub.ok && sub.at >= pollStart) {
                    proxyMessage = "订阅下载失败, 原因见上方报错"
                    return
                }
                val stage = if (proxy.running) "内核已启动, 正在拉取订阅" else "正在启动代理内核"
                proxyMessage = "$stage... ${step * POLL_STEP_MS / MS_PER_SEC}s"
            }
            proxyMessage = if (proxy.running) "订阅拉取超时或失败, 原因见上方报错" else "代理内核没有启动成功, 原因见上方报错"
        }
    }

    private fun loadProxy(): ProxyView {
        val errors = ProxyCore.recentErrors(app, MAX_ERRORS)
        val log = listOfNotNull(LinkStats.summary(app)) + LinkLog.recent(app, MAX_LOG_LINES)
        val sub = Subscription.status(app)?.let { "${LinkLog.clock(it.at)} ${it.text}" }.orEmpty()
        if (!coreAvailable) return ProxyView(summary = "安装包未内置代理内核, 当前直连", linkLog = log)
        if (ConfigStore.load(app)?.proxyEnabled != true) return ProxyView(summary = "未配置订阅, 当前直连", linkLog = log)
        if (!ProxyCore.listening()) return ProxyView(summary = "代理内核空闲 (按需启动), 当前直连", errors = errors, subStatus = sub, linkLog = log)
        val controller = ProxyController(app)
        val nodes = controller.nodes().sortedWith(compareBy({ it.delayMs <= 0 }, { it.delayMs }))
        val summary = if (nodes.isEmpty()) "内核运行中, 但订阅没有解析出节点" else "内核运行中, 订阅解析出 ${nodes.size} 个节点"
        return ProxyView(true, summary, controller.current(), nodes, if (nodes.isEmpty()) errors else emptyList(), sub, log)
    }

    private companion object {
        const val POLL_TIMES = 40
        const val POLL_STEP_MS = 1000L
        const val MS_PER_SEC = 1000L
        const val MAX_ERRORS = 3
        const val MAX_LOG_LINES = 40
    }
}
