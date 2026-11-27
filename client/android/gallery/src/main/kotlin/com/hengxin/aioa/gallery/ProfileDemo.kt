package com.hengxin.aioa.gallery

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.HomeRow
import com.hengxin.aioa.kit.HomeSection
import com.hengxin.aioa.kit.HxButton
import com.hengxin.aioa.kit.HxButtonVariant
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.Initial
import com.hengxin.aioa.kit.LiveDot
import com.hengxin.aioa.kit.SoftTag
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.hxPalette

// 点头像出资料卡 (底部弹层), 长按头像直接在输入框插入 @名字; Agent 的资料卡多一个 "Agent 设置" 入口

@Composable
private fun Sheet(content: @Composable ColumnScope.() -> Unit) {
    val c = Aioa.colors
    Column(Modifier.fillMaxSize().background(c.background)) {
        SubBar("HX-AIOA 开发", "4 人 · 3 个 Agent", back = 3)
        Box(Modifier.weight(1f)) {
            Column(Modifier.padding(horizontal = 12.dp)) {
                TimeChip("20:31", Modifier)
                Msg("小明", "成员", hxPalette().chart3, "新总览那套图表在低端机上会不会掉帧?", Modifier)
            }
            Box(Modifier.fillMaxSize().background(c.scrim.copy(alpha = 0.5f)))
            Column(
                Modifier.align(Alignment.BottomCenter).fillMaxWidth().clip(RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp))
                    .background(c.popover).padding(horizontal = 18.dp, vertical = 10.dp),
            ) {
                Box(Modifier.align(Alignment.CenterHorizontally).padding(bottom = 14.dp).width(36.dp).height(4.dp).clip(RoundedCornerShape(2.dp)).background(c.border))
                content()
            }
        }
    }
}

@Composable
private fun Fact(label: String, value: String) {
    val c = Aioa.colors
    Row(Modifier.fillMaxWidth().padding(vertical = 7.dp)) {
        Text(label, c.textSecondary, 14, Modifier.width(84.dp))
        Text(value, c.text, 14)
    }
}

/** 真人的资料卡: 身份, 群昵称, 入群时间, 最近发言; 发消息 (单聊), @TA; 群主 / 管理员多出设管理与移出。 */
@Composable
fun PersonSheetDemo() {
    val c = Aioa.colors
    val pal = hxPalette()
    Sheet {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Box {
                Initial("小", 64, pal.chart3)
                Box(Modifier.align(Alignment.BottomEnd)) { LiveDot(c.success, 8.dp) }
            }
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("小明", c.text, 20, weight = FontWeight.SemiBold)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { SoftTag("成员", c.textSecondary); SoftTag("真人", pal.chart3) }
                Text("xiaoming · 在线", c.textSecondary, 13)
            }
        }
        Spacer(Modifier.height(14.dp))
        Fact("群昵称", "小明 (前端)")
        Fact("入群", "2026-11-02 · 邀请链接")
        Fact("最近发言", "20:31 · 本群共 214 条")
        Fact("共同群", "3 个")
        Row(Modifier.padding(top = 14.dp, bottom = 6.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            HxButton("发消息", {}, Modifier.weight(1f), icon = "message-circle")
            HxButton("@TA", {}, Modifier.weight(1f), variant = HxButtonVariant.Secondary, icon = "at-sign")
        }
        Row(Modifier.padding(bottom = 10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            HxButton("设为管理员", {}, Modifier.weight(1f), variant = HxButtonVariant.Secondary)
            HxButton("移出本群", {}, Modifier.weight(1f), variant = HxButtonVariant.Destructive)
        }
    }
}

/** Agent 的资料卡: 状态, 版本, 能读的群, 最近活跃; 没有 "发消息" (Agent 只在群里)。 */
@Composable
fun AgentSheetDemo() {
    val c = Aioa.colors
    val pal = hxPalette()
    Sheet {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            AgentFace(pal.chart2, 64)
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("oa_1", c.text, 20, weight = FontWeight.SemiBold)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { SoftTag("Agent", pal.chart2); SoftTag("运行中", c.success) }
                Text("hx-aioa 1.1 · hxaioa 0.4.0", c.textSecondary, 13)
            }
        }
        Spacer(Modifier.height(14.dp))
        Fact("所在群", "HX-AIOA 开发")
        Fact("还能读", "GitHub 动态, 点子待办")
        Fact("触发", "每 30 分钟 · 下次约 12 分钟后")
        Fact("接入者", "Heng_Xin · 11-20")
        Row(Modifier.padding(top = 14.dp, bottom = 10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            HxButton("@它", {}, Modifier.weight(1f), icon = "at-sign")
            HxButton("Agent 设置", {}, Modifier.weight(1f), variant = HxButtonVariant.Secondary, icon = "settings")
        }
    }
}

/**
 * Agent 设置 (按 #117 的定论): 云 Agent 靠 skill 干活, 记忆在它自己那边, 触发方式由它上报。
 * 主人能改的只有名字, 可读的群, 大更新自动执行; 其余是只读的运行状态与版本, 加重新接入和移出。
 */
@Composable
fun AgentSettingsDemo() {
    val c = Aioa.colors
    val pal = hxPalette()
    Column(Modifier.fillMaxSize().background(c.background)) {
        SubBar("Agent 设置", "oa_1 · HX-AIOA 开发", right = "")
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 14.dp)) {
            HomeSection("基本") {
                V("名字", "oa_1", false)
                V("可读的群", "本群 + 2 个", true)
            }
            HomeSection("运行 (Agent 上报)") {
                HomeRow("触发方式", "每 30 分钟 · Asia/Shanghai", end = { SoftTag("正常", c.success) })
                HomeRow("下次触发", "约 12 分钟后 · 今天还有 6 次", divider = true)
                HomeRow("上次运行", "20:12 · 处理 4 条, 待处理 0", divider = true)
            }
            HomeSection("版本") {
                HomeRow("hx-aioa", "1.1 · 已是最新", end = { SoftTag("最新", c.success) })
                HomeRow("hengxin666.todo", "2.1 · 应有 2.2 (小更新, 下一轮自动装)", divider = true, end = { SoftTag("小更新", pal.chart2) })
                HomeRow("命令行", "hxaioa 0.4.0", divider = true)
                HomeRow("大更新自动执行", "开启后要重发一次接入语才生效", divider = true, end = { FlatSwitch(false) })
            }
            HomeSection("接入") {
                HomeRow("复制接入语", "装命令行, 登录, 装 skill, 建定时任务", end = { Icon("copy", c.textSecondary, 16.dp) })
                HomeRow("重新接入", "作废旧密钥, 换一份新的接入语", divider = true, end = { Icon("refresh-cw", pal.chart3, 16.dp) })
            }
            HomeSection("") {
                Text("移出本群", c.danger, 15, Modifier.padding(14.dp), weight = FontWeight.Medium)
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun V(label: String, value: String, divider: Boolean) {
    val c = Aioa.colors
    HomeRow(label, divider = divider, end = {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            if (value.isNotEmpty()) Text(value, c.textSecondary, 14)
            Icon("chevron-right", c.textSecondary, 14.dp)
        }
    })
}
