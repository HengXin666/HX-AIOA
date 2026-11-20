package com.hengxin.aioa.net

import android.content.Context

data class OptimizeResult(val node: String, val delayMs: Int, val alive: Int, val total: Int, val switched: Boolean)

// 测全部节点延迟并选最快的; :link 定时调用, 界面 "立即优选" 也直接调用以便立刻看到结果
object NodeOptimizer {
    // 当前节点仍可用且与最快的差距不大就不切, 避免频繁切换打断长连接
    private const val SWITCH_TOLERANCE_MS = 80

    fun run(context: Context): OptimizeResult? {
        if (!ProxyCore.listening()) return null
        val controller = ProxyController(context)
        val delays = controller.groupDelay()
        val best = delays.minByOrNull { it.value } ?: return null
        val current = controller.current()
        val currentDelay = current?.let { delays[it] }
        val switched = (currentDelay == null || currentDelay - best.value > SWITCH_TOLERANCE_MS) &&
            controller.select(best.key)
        val node = if (switched || current == null) best.key else current
        val delay = if (switched || currentDelay == null) best.value else currentDelay
        ProxyStatusStore.save(context, ProxyStatus(node, delay, System.currentTimeMillis(), delays.size))
        return OptimizeResult(node, delay, delays.size, controller.nodes().size, switched)
    }

    // 手动指定节点, 同样记录下来; 下一次定时优选只有在它明显变慢时才会换掉
    fun choose(context: Context, node: NodeInfo): Boolean {
        val ok = ProxyController(context).select(node.name)
        if (ok) ProxyStatusStore.save(context, ProxyStatus(node.name, node.delayMs, System.currentTimeMillis(), 0))
        return ok
    }
}
