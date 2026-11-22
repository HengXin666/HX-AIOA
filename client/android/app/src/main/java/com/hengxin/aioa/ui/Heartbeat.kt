package com.hengxin.aioa.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.proto.HostCard

const val BEAT_SLOTS = 60
const val BEAT_SLOT_MS = 24 * 60_000L
private const val OK = 'g'
private const val SLOW = 'y'
private const val DOWN = 'r'
private const val NONE = 'n'
private val BAR_SHAPE = RoundedCornerShape(2.dp)

/** 心跳格子 (从旧到新): 探针算好的那串按当前时间往左挪, 离线以后的格子记失联。 */
fun beatsNow(host: HostCard, now: Long = System.currentTimeMillis()): String? {
    val raw = host.beats ?: return null
    val at = host.beatsAt ?: return null
    val shift = ((now - at) / BEAT_SLOT_MS).toInt().coerceIn(0, BEAT_SLOTS)
    val fill = if (host.online) NONE else DOWN
    return (raw.takeLast(BEAT_SLOTS).padStart(BEAT_SLOTS, NONE).drop(shift) + fill.toString().repeat(shift))
}

/** 像状态页那样的一排竖条: 绿色正常, 黄色延迟大, 红色失联, 灰色没有数据。 */
@Composable
fun HeartbeatBar(beats: String, height: Dp = 22.dp, labels: Boolean = true) {
    val c = Aioa.colors
    fun color(ch: Char): Color = when (ch) {
        OK -> c.success
        SLOW -> c.warning
        DOWN -> c.danger
        else -> c.textSecondary.copy(alpha = 0.18f)
    }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(Modifier.fillMaxWidth().height(height), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
            beats.forEach { ch -> Box(Modifier.weight(1f).height(height).background(color(ch), BAR_SHAPE)) }
        }
        if (labels) {
            Row(Modifier.fillMaxWidth()) {
                Text("24 小时前", c.textSecondary, 11, Modifier.weight(1f))
                Text("现在", c.textSecondary, 11)
            }
        }
    }
}

/** 一句话说明心跳: 有红格时给出失联格数。 */
fun beatsSummary(beats: String): String {
    val down = beats.count { it == DOWN }
    val slow = beats.count { it == SLOW }
    return when {
        down > 0 -> "$down 段失联"
        slow > 0 -> "$slow 段延迟偏大"
        beats.all { it == NONE } -> "暂无心跳数据"
        else -> "24 小时全部正常"
    }
}
