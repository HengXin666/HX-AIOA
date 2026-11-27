package com.hengxin.aioa.gallery

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
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
import com.hengxin.aioa.kit.CountUp
import com.hengxin.aioa.kit.HomeRow
import com.hengxin.aioa.kit.HomeSection
import com.hengxin.aioa.kit.HomeSpace
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.Initial
import com.hengxin.aioa.kit.LiveDot
import com.hengxin.aioa.kit.Panel
import com.hengxin.aioa.kit.SectionTitle
import com.hengxin.aioa.kit.SoftTag
import com.hengxin.aioa.kit.SpaceTabs
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.enter
import com.hengxin.aioa.kit.hxPalette
import com.hengxin.aioa.kit.pointerTap

// 群资料 (QQ 的 "群聊设置"): 头部与计数, 成员横排, Agent, 快捷入口, 设置, 危险操作。
// 头部, 计数, Agent 全部来自已缓存的群列表 (ChatMeta), 打开不发请求; 成员头像走成员缓存。

private data class Person(val name: String, val role: String, val tone: Int)

private val PEOPLE = listOf(Person("Heng_Xin", "群主", 1), Person("阿杰", "管理员", 4), Person("小明", "", 3), Person("Lin", "", 5))

@Composable
private fun tone(i: Int): Color {
    val p = hxPalette()
    return listOf(p.chart1, p.chart2, p.chart3, p.chart4, p.chart5)[(i - 1).coerceIn(0, 4)]
}

@Composable
fun GroupInfoDemo() {
    val c = Aioa.colors
    val pal = hxPalette()
    Column(Modifier.fillMaxSize().background(c.background)) {
        SubBar("群聊设置", "", right = "")
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 14.dp)) {
            Panel(Modifier.padding(top = 14.dp).fillMaxWidth().enter(0)) {
                Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    Initial("开", 64, pal.chart2)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("HX-AIOA 开发", c.text, 20, weight = FontWeight.SemiBold)
                        Text("hx-aioa-dev", c.textSecondary, 13)
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            SoftTag("开发 域", pal.chart2)
                            SoftTag("日报", pal.chart3)
                        }
                    }
                    Icon("chevron-right", c.textSecondary, 18.dp)
                }
                Box(Modifier.fillMaxWidth().height(1.dp).background(c.border.copy(alpha = 0.5f)))
                Row(Modifier.padding(vertical = 12.dp)) {
                    Stat(4, "成员", Modifier.weight(1f))
                    Stat(3, "Agent", Modifier.weight(1f))
                    Stat(86, "今日消息", Modifier.weight(1f))
                }
            }
            Column(Modifier.enter(1)) {
                SectionTitle("群成员", 4, action = "全部")
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    PEOPLE.forEach { p ->
                        Column(Modifier.width(60.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Initial(p.name.take(1), 52, tone(p.tone))
                            Text(p.name, c.text, 12)
                            if (p.role.isNotEmpty()) Text(p.role, c.textSecondary, 10)
                        }
                    }
                    InviteTile()
                }
            }
            Column(Modifier.enter(2)) {
                HomeSection("Agent", 3, action = "接入") {
                    HomeRow("oa_1", "活跃 · 2 分钟前 · hxaioa 0.2.0", lead = { AgentGlyph(pal.chart2) }, end = { SoftTag("运行中", pal.chart2) })
                    HomeRow("oa_3", "指令已更新, 等它重新报到", divider = true, lead = { AgentGlyph(pal.chart3) }, end = { SoftTag("待报到", c.warning) })
                    HomeRow("待办助手", "插件 · 点子待办 · 每天 9:00", divider = true, lead = { AgentGlyph(pal.chart4) }, end = { SoftTag("插件", c.textSecondary) })
                }
            }
            Row(Modifier.padding(top = 18.dp).enter(3), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Quick("search", "查找记录", Modifier.weight(1f))
                Quick("folder", "群文件", Modifier.weight(1f))
                Quick("star", "收藏", Modifier.weight(1f))
                Quick("sparkles", "精选", Modifier.weight(1f))
            }
            Column(Modifier.enter(4)) {
                HomeSection("资料") {
                    Value("群名称", "HX-AIOA 开发", false)
                    Value("所属域", "开发", true)
                    Value("群类型", "日报", true)
                    Value("展示方式", "聊天", true)
                }
                HomeSection("提醒") {
                    Toggle("置顶", true, false)
                    Toggle("免打扰", false, true)
                    Toggle("显示 \"正在输入\"", true, true)
                }
                HomeSection("") {
                    HomeRow("清空聊天记录", lead = null, end = null)
                    Danger("删除群")
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun Stat(n: Int, label: String, modifier: Modifier) {
    val c = Aioa.colors
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        CountUp(n, 22, c.text, delayMs = 200)
        Text(label, c.textSecondary, 12)
    }
}

@Composable
private fun InviteTile() {
    val c = Aioa.colors
    val line = c.border
    Column(Modifier.width(60.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(
            Modifier.size(52.dp).drawBehind {
                drawRoundRect(line, cornerRadius = CornerRadius(14.dp.toPx()), style = Stroke(1.5.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 4.dp.toPx()))))
            },
            contentAlignment = Alignment.Center,
        ) { Icon("user-plus", c.textSecondary, 20.dp) }
        Text("邀请", c.textSecondary, 12)
    }
}

@Composable
private fun AgentGlyph(tone: Color) {
    Box(Modifier.size(36.dp).clip(RoundedCornerShape(10.dp)).background(tone.copy(alpha = 0.18f)), contentAlignment = Alignment.Center) {
        Icon("bot", tone, 18.dp)
    }
}

@Composable
private fun Quick(icon: String, label: String, modifier: Modifier) {
    val c = Aioa.colors
    Panel(modifier.pointerTap {}) {
        Column(Modifier.fillMaxWidth().padding(vertical = 14.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(icon, c.text, 20.dp)
            Text(label, c.textSecondary, 12)
        }
    }
}

@Composable
private fun Value(label: String, value: String, divider: Boolean) {
    val c = Aioa.colors
    HomeRow(label, divider = divider, end = {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(value, c.textSecondary, 14)
            Icon("chevron-right", c.textSecondary, 14.dp)
        }
    })
}

@Composable
private fun Toggle(label: String, on: Boolean, divider: Boolean) {
    HomeRow(label, divider = divider, end = { FlatSwitch(on) })
}

/** 开关: 圆角矩形轨道 + 圆角方块滑块 (不用正圆)。 */
@Composable
internal fun FlatSwitch(on: Boolean) {
    val c = Aioa.colors
    Box(
        Modifier.width(44.dp).height(26.dp).clip(RoundedCornerShape(8.dp)).background(if (on) c.accent else c.surfaceAlt).padding(3.dp),
        contentAlignment = if (on) Alignment.CenterEnd else Alignment.CenterStart,
    ) { Box(Modifier.size(20.dp).clip(RoundedCornerShape(6.dp)).background(if (on) c.onAccent else c.textSecondary)) }
}

@Composable
private fun Danger(label: String) {
    val c = Aioa.colors
    Column(Modifier.fillMaxWidth()) {
        Box(Modifier.padding(start = 14.dp).fillMaxWidth().height(1.dp).background(c.border.copy(alpha = 0.5f)))
        Text(label, c.danger, 15, Modifier.padding(horizontal = 14.dp, vertical = 14.dp), weight = FontWeight.Medium)
    }
}

/** 成员与 Agent 列表页: 标签切换, 搜索, 按身份分组。 */
@Composable
fun MembersDemo() {
    val c = Aioa.colors
    val pal = hxPalette()
    Column(Modifier.fillMaxSize().background(c.background)) {
        SubBar("成员与 Agent", "HX-AIOA 开发", right = "user-plus")
        SpaceTabs(listOf(HomeSpace("m", "成员", "", badge = 4), HomeSpace("a", "Agent", "", badge = 3)), "m", {})
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 14.dp)) {
            Row(
                Modifier.padding(top = 14.dp).fillMaxWidth().height(40.dp).clip(RoundedCornerShape(12.dp)).background(c.surface).padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon("search", c.textSecondary, 17.dp)
                Text("搜索成员", c.textSecondary, 14)
            }
            Column(Modifier.enter(0)) {
                HomeSection("群主 · 管理员", 2) {
                    Member("Heng_Xin", "你 · 在线", pal.chart1, "群主", c.warning, true, false)
                    Member("阿杰", "5 分钟前在线", pal.chart4, "管理员", pal.chart2, false, true)
                }
            }
            Column(Modifier.enter(1)) {
                HomeSection("成员", 2) {
                    Member("小明", "在线", pal.chart3, "", c.textSecondary, true, false)
                    Member("Lin", "昨天在线", pal.chart5, "", c.textSecondary, false, true)
                }
            }
            Column(Modifier.enter(2)) {
                HomeSection("邀请") {
                    HomeRow("邀请链接", "72 小时内有效 · 已用 1 / 50", lead = { AgentGlyph(c.textSecondary) }, end = { Icon("copy", c.textSecondary, 16.dp) })
                }
            }
        }
    }
}

@Composable
private fun Member(name: String, sub: String, tone: Color, role: String, roleTone: Color, online: Boolean, divider: Boolean) {
    HomeRow(name, sub, divider = divider, lead = {
        Box {
            Initial(name.take(1), 36, tone)
            if (online) Box(Modifier.align(Alignment.BottomEnd)) { LiveDot(Aioa.colors.success, 6.dp) }
        }
    }, end = { if (role.isNotEmpty()) SoftTag(role, roleTone) })
}
