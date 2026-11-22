package com.hengxin.aioa.link

import android.content.Context
import com.hengxin.aioa.Constants
import com.hengxin.aioa.config.ConfigStore
import com.hengxin.aioa.net.NodePicker
import com.hengxin.aioa.net.ProxyController
import com.hengxin.aioa.net.ProxyCore
import com.hengxin.aioa.net.Subscription
import java.io.PrintWriter

// 后台进程的诊断输出, 走 dumpsys, 不用点界面也不用 root 就能看到代理内核和订阅的真实状态
object Diag {
    private val TOP_KEY = Regex("^[A-Za-z-]+:.*")
    private const val CORE_LINES = 60
    private const val LOG_LINES = 40
    private const val NODE_LINES = 15

    fun dump(context: Context, picker: NodePicker, args: Array<out String>?, out: PrintWriter) {
        when (args?.firstOrNull()) {
            "demand" -> picker.demand()
            "reload" -> picker.reload()
            "optimize" -> picker.optimizeSoon()
            // 只给本机 adb 排查订阅用, 不进任何日志
            "suburl" -> ConfigStore.load(context)?.let { out.println("URL=" + it.subscription) }
        }
        val listening = ProxyCore.listening()
        out.println("== 代理内核")
        out.println("binary=${ProxyCore(context).available} listening=$listening")
        val sub = Subscription.file(context)
        out.println("订阅文件 exists=${sub.exists()} size=${sub.length()} at=${LinkLog.clock(sub.lastModified())}")
        Subscription.status(context)?.let { out.println("订阅状态 ok=${it.ok} ${LinkLog.clock(it.at)} ${it.text}") }
        if (listening) {
            val c = ProxyController(context)
            val nodes = c.nodes()
            out.println("节点 ${nodes.size} 个, 可用 ${nodes.count { it.delayMs > 0 }}, 当前 ${c.current()}")
            nodes.sortedBy { if (it.delayMs > 0) it.delayMs else Int.MAX_VALUE }.take(NODE_LINES)
                .forEach { out.println("  ${it.delayMs}ms ${it.type} ${it.name}") }
        }
        if (listening) {
            val c = ProxyController(context)
            out.println("provider: " + c.raw("providers", "proxies", ProxyController.PROVIDER))
            out.println("group: " + c.raw("proxies", Constants.PROXY_GROUP))
        }
        if (sub.exists()) {
            val lines = sub.readLines()
            out.println("订阅顶层键: " + lines.filter { TOP_KEY.matches(it) }.joinToString(" ") { it.substringBefore(':') })
            out.println("订阅节点行: " + lines.count { it.trimStart().startsWith("- {") || it.trimStart().startsWith("- name:") })
        }
        out.println("== core.log")
        ProxyCore.logTail(context, CORE_LINES).forEach(out::println)
        out.println("== 后台日志")
        LinkLog.recent(context, LOG_LINES).forEach(out::println)
        out.flush()
    }
}
