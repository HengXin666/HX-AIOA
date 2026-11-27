package com.hengxin.aioa.gallery

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.AreaChart
import com.hengxin.aioa.kit.CountUp
import com.hengxin.aioa.kit.Glyph
import com.hengxin.aioa.kit.Heatmap
import com.hengxin.aioa.kit.HomeRow
import com.hengxin.aioa.kit.HomeSection
import com.hengxin.aioa.kit.HxButton
import com.hengxin.aioa.kit.HxButtonSize
import com.hengxin.aioa.kit.HxButtonVariant
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.LiveDot
import com.hengxin.aioa.kit.Meter
import com.hengxin.aioa.kit.Panel
import com.hengxin.aioa.kit.Ring
import com.hengxin.aioa.kit.SectionTitle
import com.hengxin.aioa.kit.SoftTag
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.enter
import com.hengxin.aioa.kit.hxPalette
import com.hengxin.aioa.kit.pointerTap

// 总览 (默认空间) 的设计稿: 图表驱动, 入场错开, 数字滚动, 曲线描出; 数据是假的

private val MSG_24H = listOf(2f, 1f, 1f, 1f, 2f, 4f, 7f, 10f, 12f, 11f, 9f, 10f, 13f, 12f, 9f, 9f, 11f, 13f, 12f, 10f, 11f, 12f, 10f, 8f)
private val AGENT_24H = listOf(0f, 0f, 1f, 1f, 1f, 1f, 2f, 3f, 5f, 6f, 5f, 4f, 4f, 5f, 7f, 6f, 5f, 4f, 5f, 7f, 9f, 8f, 7f, 6f)
private val COMMITS = List(140) { i ->
    val r = ((i + 7) * 1103515245 + 12345) and 0x7fffffff
    when ((r shr 8) % 10) { 0, 1, 2 -> 0; 3, 4 -> 1; 5, 6 -> 2; 7, 8 -> 3; else -> 4 }
}

@Composable
internal fun OverviewSpace() {
    val c = Aioa.colors
    val pal = hxPalette()
    Column(Modifier.padding(start = 4.dp, top = 18.dp).enter(0), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("周五 · 11 月 27 日 · 晚上好", c.textSecondary, 13)
        Text("2 件事等你决定", c.text, 26, weight = FontWeight.SemiBold)
        Row(verticalAlignment = Alignment.CenterVertically) {
            LiveDot(c.success, 7.dp)
            Text("全部在线 · 3 个 Agent 正在工作", c.textSecondary, 14)
        }
    }
    Pulse(Modifier.padding(top = 16.dp).enter(1))
    Column(Modifier.enter(2)) {
        HomeSection("需要我", 2, strong = true) {
            HomeRow("DSH 请求部署到生产", "镜像已推送, 健康检查通过", "1 分钟前", lead = { Glyph("bot", c.warning) }) {
                Row(Modifier.padding(top = 2.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    HxButton("允许", {}, size = HxButtonSize.Sm)
                    HxButton("先不", {}, variant = HxButtonVariant.Secondary, size = HxButtonSize.Sm)
                }
            }
            HomeRow("GitHub: 有新的登录", "Linux · Chrome, 不是你就去改密码", "8 分钟前", divider = true,
                lead = { Glyph("shield-check", c.danger) }, end = { SoftTag("安全", c.danger) })
        }
    }
    Column(Modifier.enter(3)) {
        SectionTitle("Agent", 3, action = "全部")
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            AgentCard("oa_1", "新总览设计稿", "第 3 / 5 步", 0.6f, pal.chart2, 0)
            AgentCard("oa_3", "插件私有源", "等待 CI", 0.3f, pal.chart3, 1)
            AgentCard("DSH", "部署到生产", "等你确认", 0.9f, pal.chart4, 2)
        }
    }
    Column(Modifier.enter(4)) {
        SectionTitle("资源", action = "全部")
        Panel(Modifier.fillMaxWidth()) {
            HostBlock("hx-pxy", "VPS · 东京", 0.18f, 0.41f, listOf(12f, 15f, 14f, 22f, 18f, 16f, 19f, 18f, 24f, 17f, 20f), pal.chart2)
            Box(Modifier.fillMaxWidth().height(1.dp).background(c.border.copy(alpha = 0.5f)))
            HostBlock("nas-01", "家里 · 群晖", 0.06f, 0.58f, listOf(5f, 7f, 6f, 9f, 6f, 5f, 7f, 6f, 8f, 6f, 7f), pal.chart5)
        }
    }
    Column(Modifier.enter(5)) {
        SectionTitle("GitHub", action = "HX-AIOA")
        Panel(Modifier.fillMaxWidth()) {
            Row(Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp), verticalAlignment = Alignment.Bottom) {
                CountUp(23, 28, c.text, delayMs = 400)
                Text("  次提交 · 本周", c.textSecondary, 13, Modifier.padding(bottom = 4.dp))
                Spacer(Modifier.weight(1f))
                Column(horizontalAlignment = Alignment.End) {
                    Text("连续 12 天", c.text, 13, weight = FontWeight.Medium)
                    Text("合并 PR 4 个", c.textSecondary, 12)
                }
            }
            Heatmap(COMMITS, 7, pal.chart5, Modifier.padding(16.dp).fillMaxWidth().height(118.dp), delayMs = 450)
            HomeRow("android.yml 构建通过", "安卓 #123 已发布", "昨天", divider = true, lead = { Glyph("circle-check", c.success) })
        }
    }
    Column(Modifier.enter(6)) {
        SectionTitle("插件区块", action = "添加")
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            PluginTile("mail", "邮件", 5, "封未读", pal.chart3, Modifier.weight(1f))
            PluginTile("lightbulb", "点子待办", 5, "条未完成", pal.chart4, Modifier.weight(1f))
        }
        Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            PluginTile("flame", "信息流", 3, "条精选", pal.chart2, Modifier.weight(1f))
            AddTile(Modifier.weight(1f))
        }
    }
}

@Composable
private fun Pulse(modifier: Modifier) {
    val c = Aioa.colors
    val pal = hxPalette()
    Panel(modifier.fillMaxWidth()) {
        Row(Modifier.padding(start = 16.dp, end = 12.dp, top = 14.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("今日脉搏", c.text, 15, weight = FontWeight.SemiBold)
            Spacer(Modifier.weight(1f))
            LiveDot(pal.chart2, 6.dp)
            Text("实时", c.textSecondary, 12)
        }
        Row(Modifier.padding(start = 16.dp, end = 16.dp, top = 12.dp)) {
            Metric(128, "消息", "+12%", c.success, 0, Modifier.weight(1f))
            Metric(14, "Agent 运行", "+3", c.success, 120, Modifier.weight(1f))
            Metric(37, "事件", "−4", c.textSecondary, 240, Modifier.weight(1f))
        }
        Row(Modifier.padding(start = 16.dp, top = 14.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Legend(pal.chart1, "消息")
            Legend(pal.chart2, "Agent")
        }
        Box(Modifier.padding(start = 8.dp, end = 8.dp, top = 6.dp).fillMaxWidth().height(112.dp)) {
            AreaChart(MSG_24H, pal.chart1, Modifier.fillMaxWidth().height(112.dp), delayMs = 150)
            AreaChart(AGENT_24H, pal.chart2, Modifier.fillMaxWidth().height(112.dp), delayMs = 300, grid = false)
        }
        Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 6.dp, bottom = 14.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            listOf("00:00", "06:00", "12:00", "18:00", "现在").forEach { Text(it, c.textSecondary, 11) }
        }
    }
}

@Composable
private fun Metric(n: Int, label: String, delta: String, tone: Color, delay: Int, modifier: Modifier) {
    val c = Aioa.colors
    Column(modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        CountUp(n, 26, c.text, delayMs = delay)
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(label, c.textSecondary, 12)
            Text(delta, tone, 12, weight = FontWeight.Medium)
        }
    }
}

@Composable
private fun Legend(color: Color, label: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.size(8.dp).clip(RoundedCornerShape(2.dp)).background(color))
        Text(label, Aioa.colors.textSecondary, 12)
    }
}

@Composable
private fun AgentCard(name: String, task: String, step: String, f: Float, tone: Color, i: Int) {
    val c = Aioa.colors
    Panel(Modifier.width(158.dp).pointerTap {}) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                Ring(f, tone, Modifier.size(54.dp), delayMs = 300 + i * 120) {
                    Text("${(f * 100).toInt()}%", c.text, 12, weight = FontWeight.SemiBold)
                }
                Spacer(Modifier.weight(1f))
                LiveDot(tone, 6.dp)
            }
            Spacer(Modifier.height(14.dp))
            Text(name, c.text, 15, weight = FontWeight.SemiBold)
            Text(task, c.textSecondary, 13)
            Text(step, tone, 12, Modifier.padding(top = 6.dp), weight = FontWeight.Medium)
        }
    }
}

@Composable
internal fun HostBlock(name: String, where: String, cpu: Float, mem: Float, trend: List<Float>, tone: Color) {
    val c = Aioa.colors
    Column(Modifier.fillMaxWidth().padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(name, c.text, 15, weight = FontWeight.SemiBold)
            Text(where, c.textSecondary, 12)
            Spacer(Modifier.weight(1f))
            SoftTag("在线", c.success)
        }
        Row(Modifier.padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                MeterRow("CPU", cpu, tone)
                MeterRow("内存", mem, tone)
            }
            AreaChart(trend, tone, Modifier.width(96.dp).height(44.dp), delayMs = 500, grid = false)
        }
    }
}

@Composable
private fun MeterRow(label: String, f: Float, tone: Color) {
    val c = Aioa.colors
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, c.textSecondary, 12, Modifier.width(30.dp))
        Meter(f, tone, Modifier.weight(1f).height(8.dp), segments = 20, delayMs = 400)
        Text("${(f * 100).toInt()}%", c.text, 12, Modifier.width(32.dp), weight = FontWeight.Medium)
    }
}

@Composable
private fun PluginTile(icon: String, title: String, n: Int, unit: String, tone: Color, modifier: Modifier) {
    val c = Aioa.colors
    Panel(modifier.pointerTap {}) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(30.dp).clip(RoundedCornerShape(9.dp)).background(tone.copy(alpha = 0.18f)), contentAlignment = Alignment.Center) {
                    Icon(icon, tone, 16.dp)
                }
                Spacer(Modifier.weight(1f))
                Text("插件", c.textSecondary, 10, Modifier.clip(RoundedCornerShape(5.dp)).background(c.surfaceAlt).padding(horizontal = 5.dp, vertical = 1.dp))
            }
            Row(Modifier.padding(top = 14.dp), verticalAlignment = Alignment.Bottom) {
                CountUp(n, 24, c.text, delayMs = 500)
                Text(" $unit", c.textSecondary, 12, Modifier.padding(bottom = 3.dp))
            }
            Text(title, c.textSecondary, 13)
        }
    }
}

@Composable
private fun AddTile(modifier: Modifier) {
    val c = Aioa.colors
    val line = c.border
    Column(
        modifier.height(124.dp).drawBehind {
            val dash = PathEffect.dashPathEffect(floatArrayOf(5.dp.toPx(), 5.dp.toPx()))
            drawRoundRect(line, cornerRadius = CornerRadius(20.dp.toPx()), style = Stroke(1.5.dp.toPx(), pathEffect = dash))
        }.clip(RoundedCornerShape(20.dp)).pointerTap {},
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon("plus", c.textSecondary, 20.dp)
        Text("添加区块", c.text, 14, Modifier.padding(top = 8.dp), weight = FontWeight.Medium)
        Text("从插件市场", c.textSecondary, 12)
    }
}
