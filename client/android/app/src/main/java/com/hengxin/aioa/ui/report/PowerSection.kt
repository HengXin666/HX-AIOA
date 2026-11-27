package com.hengxin.aioa.ui.report

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.data.PowerModel
import com.hengxin.aioa.data.PowerParts
import com.hengxin.aioa.data.WeekReport
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.CardState
import com.hengxin.aioa.kit.StateBody
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.hxPalette

// 周报耗电块 (#142): 只算本 App, 按 CPU / 流量 / 唤醒 / 前台时长估算; 整机电量只留一行做参考

private val WEEK_DAYS = listOf("一", "二", "三", "四", "五", "六", "日")
private const val CENTI = 100.0
private const val PCT = 100.0

/** 估算口径, 周报与调试页共用。 */
fun powerNote(): String = "估算口径: 第三方 App 读不到系统电池统计 (BATTERY_STATS 是系统权限), 这里按 " +
    "前台时长 x ${PowerModel.SCREEN_MA.toInt()} mA (屏幕) + 本 App 进程 CPU 时间 x ${PowerModel.CPU_MA.toInt()} mA + " +
    "本 App 流量折算收发时长 (Wi-Fi ${PowerModel.WIFI_MA.toInt()} mA @1 Mbit/s, 蜂窝 ${PowerModel.CELL_MA.toInt()} mA @200 kbit/s) + " +
    "看门狗唤醒每次 ${PowerModel.WAKE_S.toInt()} 秒 x ${PowerModel.AWAKE_MA.toInt()} mA 算。常量取 AOSP 功耗配置示例值, 不是这台手机实测, 只看趋势; " +
    "CPU, 流量, 唤醒从这一版起开始记。"

fun mah(v: Double): String = if (v >= 10) "%.0f mAh".format(v) else "%.1f mAh".format(v)

/** 各分项: 名字与取值, 顺序与图例颜色对应。 */
fun powerParts(p: PowerParts): List<Pair<String, Double>> = listOf("屏幕" to p.screen, "CPU" to p.cpu, "网络" to p.net, "唤醒" to p.wake)

@Composable
fun powerColors() = hxPalette().let { listOf(it.chart2, it.chart4, it.chart3, it.chart5) }

@Composable
fun PowerSection(r: WeekReport, modifier: Modifier) {
    val c = Aioa.colors
    val total = r.powerTotal
    val colors = powerColors()
    Section("06 耗电 · 本 App (估算)", modifier) {
        if (total.total <= 0.0) StateBody(CardState.Empty, "这一周还没有耗电采样: 从这一版起, App 退到后台或后台服务唤醒时记一次。") {}
        else {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Stat(mah(total.total), "本周合计", Modifier.weight(1f))
                val share = PowerModel.share(total.total, r.deviceMah)
                Stat(share?.let { "%.0f%%".format(it * PCT) } ?: "-", "占同期整机掉电", Modifier.weight(1f))
                Stat(mah(total.total / r.days), "日均", Modifier.weight(1f))
            }
            val days = Array(r.days) { d -> powerParts(r.power[d]).map { (it.second * CENTI).toInt() }.toIntArray() }
            StackBars(days, colors, emptyList(), WEEK_DAYS.map { "周$it" }, c.text, Modifier.fillMaxWidth().height(150.dp))
            Legend(powerParts(total).mapIndexed { i, (name, v) -> "$name ${mah(v)}" to colors[i] })
        }
        val on = r.battery.perHour(r.battery.onMs, r.battery.onDrop)
        val off = r.battery.perHour(r.battery.offMs, r.battery.offDrop)
        if (on != null || off != null) {
            Text("整机 (参考): 熄屏 ${off?.let { "-%.1f%%/小时".format(it) } ?: "-"}, 亮屏 ${on?.let { "-%.1f%%/小时".format(it) } ?: "-"}" +
                (r.capacityMah?.let { ", 电池约 %.0f mAh".format(it) } ?: ""), c.textSecondary, 12, maxLines = 2)
        }
        Text(powerNote(), c.textSecondary, 11, maxLines = 8)
    }
}
