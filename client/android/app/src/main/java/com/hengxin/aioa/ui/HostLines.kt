package com.hengxin.aioa.ui

import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Card
import com.hengxin.aioa.kit.CardHeader
import com.hengxin.aioa.kit.Meter

private const val FULL = 100.0
private val METER_W = 44.dp

/** 资源页的主机列表 (#138): 一行一台, 状态色图标, 系统与 CPU 压到右边, 最右 CPU 分段条; 点一行展开它的详细面板。 */
@Composable
internal fun HostLines(state: MetricsState, open: String?, toggle: (String) -> Unit) {
    val hosts = state.hosts
    if (hosts.isEmpty()) return
    val c = Aioa.colors
    Card {
        CardHeader("server", "主机", "${hosts.count { it.online }}/${hosts.size} 在线")
        hosts.forEach { h ->
            val live = if (h.online) state.samples[h.subject]?.lastOrNull() else null
            val cpu = (h.last?.values.orEmpty() + live?.values.orEmpty())[FIELD_CPU]
            val meta = if (h.online) listOfNotNull(h.os, cpu?.let { "CPU ${one(it)}%" }).joinToString(" · ") else "离线 · ${ago(h.seen)}失联"
            val shown = h.subject == open
            OneRow(if (shown) "chevron-down" else "server", h.hostname ?: h.subject, meta, if (h.online) c.success else c.danger, onClick = { toggle(h.subject) }) {
                if (h.online && cpu != null) Meter((cpu / FULL).toFloat(), c.accent, Modifier.width(METER_W).height(6.dp), segments = 10)
            }
        }
    }
}
