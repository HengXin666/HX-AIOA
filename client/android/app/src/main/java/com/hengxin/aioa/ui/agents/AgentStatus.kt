package com.hengxin.aioa.ui.agents

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.ui.chat.ChatAgent
import kotlinx.coroutines.delay

private const val MINUTE = 60_000L
private const val HOUR = 60 * MINUTE
private const val DAY = 24 * HOUR
private const val TICK_MS = 15_000L
private val LISTENING = Color(0xFF22C55E)
private val PENDING = Color(0xFFF59E0B)

/** Agent 的状态: 正在监听 > 已接入 > 待重新报到 > 还没接入。 */
enum class AgentState { LISTENING, JOINED, PENDING, WAITING }

fun stateOf(a: ChatAgent, listening: Boolean): AgentState = when {
    a.joined == null -> AgentState.WAITING
    listening -> AgentState.LISTENING
    a.pending -> AgentState.PENDING
    else -> AgentState.JOINED
}

/** 卡片第二行的状态说明。 */
fun stateLine(a: ChatAgent, state: AgentState, now: Long): String = when (state) {
    AgentState.WAITING -> "还没报到, 把接入语发给它"
    AgentState.LISTENING -> "正在监听"
    AgentState.PENDING -> "指令已更新, 等它重新报到"
    AgentState.JOINED -> a.active?.let { "${ago(it, now)}活跃" } ?: "已接入, 还没有动静"
}

fun ago(ts: Long, now: Long): String {
    val d = (now - ts).coerceAtLeast(0)
    return when {
        d < MINUTE -> "刚刚"
        d < HOUR -> "${d / MINUTE} 分钟前"
        d < DAY -> "${d / HOUR} 小时前"
        else -> "${d / DAY} 天前"
    }
}

/** 将来的相对时间: "x 分钟后"。 */
fun until(ts: Long, now: Long): String {
    val d = (ts - now).coerceAtLeast(0)
    return when {
        d < MINUTE -> "1 分钟内"
        d < HOUR -> "${d / MINUTE} 分钟后"
        d < DAY -> "${d / HOUR} 小时后"
        else -> "${d / DAY} 天后"
    }
}

@Composable
fun StatusDot(state: AgentState, size: Dp = 10.dp) {
    val c = MaterialTheme.colorScheme
    val color = when (state) {
        AgentState.LISTENING -> LISTENING
        AgentState.JOINED -> c.primary
        AgentState.PENDING -> PENDING
        AgentState.WAITING -> c.outline
    }
    Box(Modifier.size(size).background(color, CircleShape))
}

/** 每 15 秒刷新一次的当前时间, 用于 "x 分钟前" 和监听到期。 */
@Composable
fun rememberNow(): Long {
    val now by produceState(System.currentTimeMillis()) {
        while (true) {
            delay(TICK_MS)
            value = System.currentTimeMillis()
        }
    }
    return now
}
