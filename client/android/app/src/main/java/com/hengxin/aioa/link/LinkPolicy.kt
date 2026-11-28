package com.hengxin.aioa.link

import com.hengxin.aioa.Constants

/**
 * 后台长连接的纯决策 (#149), 不碰 Android 类, 便于单测。
 * 前提: CF 边缘约 100 秒双向无数据就回收连接, 所以 "空闲多久" 直接决定连接是否还活着。
 */
object LinkPolicy {
    enum class Wake { SKIP, PROBE, RECONNECT, WAIT }

    /** 看门狗或亮屏唤醒时怎么处理当前连接。skipIdleMs 内有过流量就不必探测。 */
    fun onWake(open: Boolean, idleMs: Long, sinceConnectMs: Long, skipIdleMs: Long): Wake = when {
        open && idleMs < skipIdleMs -> Wake.SKIP
        open && idleMs < Constants.EDGE_IDLE_MS -> Wake.PROBE
        // 边缘早已回收, 发 ping 等 pong 只是白等 5 秒
        open -> Wake.RECONNECT
        sinceConnectMs > Constants.CONNECT_STALL_MS -> Wake.RECONNECT
        else -> Wake.WAIT
    }

    /**
     * :link 保活: 返回现在是否发 ping, 以及多久后再检查。
     * 空闲已超过边缘上限时连接已死, 不发也不重连, 交给看门狗 / 亮屏 / 网络回调, 免得深睡里短暂醒来时反复建连。
     */
    fun keepAlive(idleMs: Long): Pair<Boolean, Long> {
        val ping = idleMs in Constants.LINK_KEEPALIVE_MS until Constants.EDGE_IDLE_MS
        val next = if (ping || idleMs >= Constants.EDGE_IDLE_MS) Constants.LINK_KEEPALIVE_MS else Constants.LINK_KEEPALIVE_MS - idleMs
        return ping to next
    }

    /** 读到失败或关闭时连接已空闲多久: 超过边缘上限就是正常回收, 不算异常断线。 */
    fun idleClosed(idleMs: Long): Boolean = idleMs >= Constants.EDGE_IDLE_MS

    /** 补拉 (seq <= welcome.head) 的事件是否照常提醒: 首次同步与 resync 不提醒, 太旧的不提醒, 每次重连有上限。 */
    fun notifyReplay(since: Long, resync: Boolean, evTs: Long, now: Long, notified: Int): Boolean =
        since > 0 && !resync && now - evTs <= Constants.REPLAY_NOTIFY_MAX_AGE_MS && notified < Constants.REPLAY_NOTIFY_MAX

    /** 指数退避: 前台上限 30 秒, App 不在前台时上限 2 分钟。 */
    class Backoff {
        var current = Constants.RECONNECT_MIN_MS
            private set

        fun reset() {
            current = Constants.RECONNECT_MIN_MS
        }

        /** 返回这次要等的毫秒数, 并把下一次翻倍。 */
        fun next(background: Boolean): Long {
            val cap = if (background) Constants.RECONNECT_BG_MAX_MS else Constants.RECONNECT_MAX_MS
            val wait = current.coerceAtMost(cap)
            current = (wait * 2).coerceAtMost(cap)
            return wait
        }
    }
}
