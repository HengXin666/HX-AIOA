package com.hengxin.aioa.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.produceState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.data.AppPower
import com.hengxin.aioa.data.PowerModel
import com.hengxin.aioa.data.PowerParts
import com.hengxin.aioa.data.UsageLog
import com.hengxin.aioa.data.WeekReports
import com.hengxin.aioa.kit.AreaChart
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.ui.report.Legend
import com.hengxin.aioa.ui.report.mah
import com.hengxin.aioa.ui.report.powerColors
import com.hengxin.aioa.ui.report.powerParts
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

// 调试页 "近 24 小时耗电 · 本 App (估算)" (#142): 每小时一点, 与周报同一套估算

private const val HOURS = 24
private const val HOUR_MS = 3_600_000L

/** 近 24 小时按小时切的本 App 估算耗电 (最后一段到现在)。 */
class AppPowerDay(val hours: List<PowerParts>, val capacityMah: Double?) {
    val total: PowerParts get() = hours.fold(PowerParts.ZERO) { a, b -> a + b }
}

private fun loadDay(context: android.content.Context): AppPowerDay {
    val now = System.currentTimeMillis()
    val end = now - now % HOUR_MS + HOUR_MS
    val edges = LongArray(HOURS + 1) { end - (HOURS - it) * HOUR_MS }
    AppPower.sample(context, "ui", now)
    val sessions = WeekReports.sessionsOf(context, UsageLog(context), edges.first(), now)
    return AppPowerDay(PowerModel.buckets(AppPower.samples(context, edges.first(), end), sessions, edges), AppPower.capacityMah(context))
}

@Composable
fun AppPowerVisual(tick: Int) {
    val context = LocalContext.current
    val day = produceState<AppPowerDay?>(null, tick) { value = withContext(Dispatchers.IO) { runCatching { loadDay(context) }.getOrNull() } }.value ?: return
    val c = Aioa.colors
    val colors = powerColors()
    val total = day.total
    Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (total.total <= 0.0) return@Column Text("还没有采样: 从这一版起, App 退到后台或后台服务唤醒时记一次。", c.textSecondary, 12, maxLines = 2)
        Row(verticalAlignment = androidx.compose.ui.Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(mah(total.total), c.text, 18, weight = FontWeight.SemiBold)
            day.capacityMah?.let { Text("约满电的 %.1f%%".format(total.total * 100 / it), c.textSecondary, 12) }
        }
        AreaChart(day.hours.map { it.total.toFloat() }, colors[0], Modifier.fillMaxWidth().height(100.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { listOf("24 小时前", "12 小时前", "现在").forEach { Text(it, c.textSecondary, 11) } }
        Legend(powerParts(total).mapIndexed { i, (name, v) -> "$name ${mah(v)}" to colors[i] })
    }
}
