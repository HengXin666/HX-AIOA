package com.hengxin.aioa.net

import android.content.Context
import com.hengxin.aioa.Constants
import com.hengxin.aioa.config.AppConfig
import java.io.File
import java.net.InetSocketAddress
import java.net.Socket
import java.security.SecureRandom

// 内置 mihomo 内核: 由它解析订阅 (Clash YAML, base64 分享链接等) 并承载所有节点协议
// 二进制随 APK 以 libmihomo.so 的名字放在 nativeLibraryDir, 由 :link 进程以子进程方式拉起
class ProxyCore(private val context: Context) {

    private val home = File(context.filesDir, HOME_DIR)
    private val executable = File(context.applicationInfo.nativeLibraryDir, BINARY_NAME)
    private var process: Process? = null

    val available: Boolean get() = executable.exists()

    fun start(config: AppConfig): Boolean {
        stop()
        if (!available || !config.proxyEnabled) return false
        home.mkdirs()
        val configFile = File(home, CONFIG_FILE)
        configFile.writeText(buildConfig(config.subscription, secret(context)))
        // 上次进程被杀后残留的内核还占着端口: 直接让它重载新配置
        if (listening()) return ProxyController(context).reload(configFile.absolutePath)
        process = runCatching {
            ProcessBuilder(executable.absolutePath, "-d", home.absolutePath, "-f", File(home, CONFIG_FILE).absolutePath)
                .redirectErrorStream(true)
                .redirectOutput(File(home, LOG_FILE))
                .start()
        }.getOrNull()
        return process != null && waitReady()
    }

    fun stop() {
        process?.destroy()
        process = null
    }

    private fun waitReady(): Boolean {
        val deadline = System.currentTimeMillis() + Constants.PROXY_READY_TIMEOUT_MS
        while (System.currentTimeMillis() < deadline) {
            if (listening()) return true
            Thread.sleep(READY_POLL_MS)
        }
        return false
    }

    private fun buildConfig(subscription: String, secret: String): String = """
        |mixed-port: ${Constants.PROXY_PORT}
        |bind-address: ${Constants.LOOPBACK}
        |allow-lan: false
        |mode: rule
        |log-level: warning
        |ipv6: true
        |geo-auto-update: false
        |external-controller: ${Constants.LOOPBACK}:${Constants.PROXY_CONTROLLER_PORT}
        |secret: ${quote(secret)}
        |profile:
        |  store-selected: true
        |proxy-providers:
        |  sub:
        |    type: http
        |    url: ${quote(subscription)}
        |    path: ./providers/sub.yaml
        |    interval: $SUBSCRIPTION_REFRESH_SEC
        |proxy-groups:
        |  - name: ${Constants.PROXY_GROUP}
        |    type: select
        |    use: [sub]
        |rules:
        |  - MATCH,${Constants.PROXY_GROUP}
        |""".trimMargin()

    // YAML 单引号字符串, 内部单引号写两次
    private fun quote(value: String) = "'" + value.replace("'", "''") + "'"

    companion object {
        private const val HOME_DIR = "mihomo"
        private const val BINARY_NAME = "libmihomo.so"
        private const val CONFIG_FILE = "config.yaml"
        private const val LOG_FILE = "core.log"
        private const val SECRET_FILE = "secret"
        private const val SECRET_BYTES = 16
        private const val READY_POLL_MS = 100L
        private const val SUBSCRIPTION_REFRESH_SEC = 86_400

        fun secret(context: Context): String {
            val file = File(File(context.filesDir, HOME_DIR), SECRET_FILE)
            if (file.exists()) return file.readText()
            val bytes = ByteArray(SECRET_BYTES).also { SecureRandom().nextBytes(it) }
            val value = bytes.joinToString("") { "%02x".format(it) }
            file.parentFile?.mkdirs()
            file.writeText(value)
            return value
        }

        // 端口能连上就认为内核在跑, 两个进程都用这个判断, 不需要跨进程通信
        fun listening(): Boolean = runCatching {
            Socket().use { it.connect(InetSocketAddress(Constants.LOOPBACK, Constants.PROXY_PORT), Constants.PROXY_PROBE_TIMEOUT_MS) }
            true
        }.getOrDefault(false)
    }
}
