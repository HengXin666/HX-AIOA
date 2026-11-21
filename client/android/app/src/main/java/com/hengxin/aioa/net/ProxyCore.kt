package com.hengxin.aioa.net

import android.content.Context
import com.hengxin.aioa.Constants
import com.hengxin.aioa.config.AppConfig
import java.io.File
import java.net.InetSocketAddress
import java.net.Socket
import java.security.SecureRandom

// 内置 mihomo 内核: 解析 App 下载好的订阅文件 (Clash YAML, base64 分享链接等) 并承载所有节点协议
// 二进制随 APK 以 libmihomo.so 的名字放在 nativeLibraryDir, 由 :link 进程以子进程方式拉起
class ProxyCore(private val context: Context) {

    private val home = home(context)
    private val executable = File(context.applicationInfo.nativeLibraryDir, BINARY_NAME)
    private var process: Process? = null

    val available: Boolean get() = executable.exists()

    fun start(config: AppConfig): Boolean {
        stop()
        if (!available || !config.proxyEnabled) return false
        home.mkdirs()
        val configFile = File(home, CONFIG_FILE)
        configFile.writeText(buildConfig(secret(context)))
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

    private fun buildConfig(secret: String): String = """
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
        |dns:
        |  enable: true
        |  ipv6: true
        |  default-nameserver: $DNS_SERVERS
        |  nameserver: $DNS_SERVERS
        |  proxy-server-nameserver: $DNS_SERVERS
        |proxy-providers:
        |  ${ProxyController.PROVIDER}:
        |    type: file
        |    path: ${Subscription.PROVIDER_PATH}
        |proxy-groups:
        |  - name: ${Constants.PROXY_GROUP}
        |    type: select
        |    use: [${ProxyController.PROVIDER}]
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
        // 安卓没有 /etc/resolv.conf, Go 程序默认去问 [::1]:53 必然失败, 订阅域名解析不了, 必须显式给 DNS
        private const val DNS_SERVERS = "[223.5.5.5, 119.29.29.29]"

        fun home(context: Context) = File(context.filesDir, HOME_DIR)

        // 内核日志里最近的报错/警告, 订阅下载或解析失败时给界面看
        fun recentErrors(context: Context, max: Int): List<String> {
            val file = File(home(context), LOG_FILE)
            if (!file.exists()) return emptyList()
            return file.readLines().filter { "level=error" in it || "level=warning" in it }
                .takeLast(max)
                .map { line -> line.substringAfter("msg=", line).trim('"') }
        }

        fun secret(context: Context): String {
            val file = File(home(context), SECRET_FILE)
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
