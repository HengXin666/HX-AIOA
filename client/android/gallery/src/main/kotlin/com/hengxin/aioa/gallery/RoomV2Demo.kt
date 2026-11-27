package com.hengxin.aioa.gallery

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.CheckBox
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.Initial
import com.hengxin.aioa.kit.LiveDot
import com.hengxin.aioa.kit.Meter
import com.hengxin.aioa.kit.SoftTag
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.hxPalette

// 会话页的交互稿: @ 选人, 按住说话, 长按菜单, 多选, 合并转发卡片

private const val LONG = 40

@Composable
private fun Chat(modifier: Modifier = Modifier, select: Boolean = false, dim: Int = -1) {
    val pal = hxPalette()
    Column(modifier.padding(horizontal = 12.dp)) {
        TimeChip("20:31", Modifier)
        Pick(select, false, dim, 0) { Msg("小明", "成员", pal.chart3, "新总览那套图表在低端机上会不会掉帧?", Modifier) }
        Pick(select, true, dim, 1) {
            AgentMsg("oa_1", pal.chart2, Modifier) { Text("图表全在 Canvas 里画, 数据不变不重组; 入场 36 帧。", Aioa.colors.text, 15, maxLines = LONG) }
        }
        Pick(select, true, dim, 2) { Mine("先把侧栏接进 App, 底栏去掉", "", Modifier) }
        Pick(select, false, dim, 3) { Msg("阿杰", "管理员", pal.chart4, "侧栏推开那个手感不错", Modifier) }
    }
}

// 多选时每条前面一个勾; dim 为长按时把其它消息压暗
@Composable
private fun Pick(select: Boolean, on: Boolean, dim: Int, me: Int, content: @Composable () -> Unit) {
    val alpha = if (dim >= 0 && dim != me) 0.25f else 1f
    Row(Modifier.graphicsLayer { this.alpha = alpha }, verticalAlignment = Alignment.CenterVertically) {
        if (select) Box(Modifier.width(36.dp)) { CheckBox(on) }
        Box(Modifier.weight(1f)) { content() }
    }
}

/** 输入 "@" 弹出: 先 Agent 后真人, 可搜索, 顶部 "@全体成员"。长按头像同样插入 @名字。 */
@Composable
fun MentionDemo() {
    val c = Aioa.colors
    val pal = hxPalette()
    Column(Modifier.fillMaxSize().background(c.background)) {
        SubBar("HX-AIOA 开发", "4 人 · 3 个 Agent", back = 3)
        Box(Modifier.weight(1f)) {
            Chat(Modifier.padding(top = 4.dp))
            Column(
                Modifier.align(Alignment.BottomCenter).padding(horizontal = 10.dp, vertical = 8.dp).fillMaxWidth()
                    .shadow(16.dp, RoundedCornerShape(16.dp)).clip(RoundedCornerShape(16.dp)).background(c.popover)
                    .border(1.dp, c.border.copy(alpha = 0.6f), RoundedCornerShape(16.dp)).padding(vertical = 6.dp),
            ) {
                Text("选择要 @ 的人", c.textSecondary, 12, Modifier.padding(start = 14.dp, top = 4.dp, bottom = 4.dp))
                MentionRow({ Box(Modifier.size(32.dp).clip(RoundedCornerShape(9.dp)).background(c.surfaceAlt), contentAlignment = Alignment.Center) { Icon("users", c.text, 16.dp) } }, "全体成员", "4 人", null)
                MentionRow({ AgentFace(pal.chart2, 32) }, "oa_1", "Agent · 运行中", pal.chart2, true)
                MentionRow({ AgentFace(pal.chart3, 32) }, "oa_3", "Agent · 待报到", pal.chart3)
                MentionRow({ Initial("小", 32, pal.chart3) }, "小明", "成员 · 在线", null)
                MentionRow({ Initial("阿", 32, pal.chart4) }, "阿杰", "管理员", null)
            }
        }
        Composer("", text = "@o")
    }
}

@Composable
private fun MentionRow(face: @Composable () -> Unit, name: String, sub: String, agent: androidx.compose.ui.graphics.Color?, on: Boolean = false) {
    val c = Aioa.colors
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 6.dp).clip(RoundedCornerShape(10.dp)).background(if (on) c.surfaceAlt else c.popover).padding(horizontal = 8.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        face()
        Text(name, c.text, 15, weight = FontWeight.Medium)
        if (agent != null) SoftTag("Agent", agent)
        Spacer(Modifier.weight(1f))
        Text(sub, c.textSecondary, 12)
    }
}

@Composable
internal fun AgentFace(tone: androidx.compose.ui.graphics.Color, size: Int) {
    Box(Modifier.size(size.dp).clip(RoundedCornerShape((size * 0.3f).dp)).background(tone.copy(alpha = 0.18f)), contentAlignment = Alignment.Center) {
        Icon("bot", tone, (size * 0.5f).dp)
    }
}

/** 按住说话 (微信式): 底栏切成 "按住 说话", 按下后浮出录音面板, 上滑取消, 右滑转文字。 */
@Composable
fun VoiceDemo() {
    val c = Aioa.colors
    val pal = hxPalette()
    Column(Modifier.fillMaxSize().background(c.background)) {
        SubBar("HX-AIOA 开发", "4 人 · 3 个 Agent", back = 3)
        Box(Modifier.weight(1f)) {
            Chat(Modifier.padding(top = 4.dp))
            Box(Modifier.fillMaxSize().background(c.scrim.copy(alpha = 0.55f)))
            Column(Modifier.align(Alignment.BottomCenter).padding(bottom = 18.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(18.dp)) {
                Column(
                    Modifier.width(220.dp).clip(RoundedCornerShape(18.dp)).background(c.accent).padding(16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Meter(0.7f, c.onAccent, Modifier.fillMaxWidth().height(28.dp), segments = 28)
                    Text("0:07", c.onAccent, 13, weight = FontWeight.Medium)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(90.dp)) {
                    VoiceTarget("x", "上滑取消", c.danger)
                    VoiceTarget("languages", "右滑转文字", pal.chart2)
                }
            }
        }
        Composer("", voice = true)
    }
}

@Composable
private fun VoiceTarget(icon: String, label: String, tone: androidx.compose.ui.graphics.Color) {
    val c = Aioa.colors
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.size(60.dp).clip(RoundedCornerShape(18.dp)).background(c.surface).border(1.dp, tone.copy(alpha = 0.6f), RoundedCornerShape(18.dp)), contentAlignment = Alignment.Center) {
            Icon(icon, tone, 24.dp)
        }
        Text(label, c.text, 12)
    }
}

/** 长按消息 (对齐 QQ): 压暗其它消息, 气泡上方弹出两排操作。自己的消息 2 分钟内有撤回。 */
@Composable
fun LongPressDemo() {
    val c = Aioa.colors
    Column(Modifier.fillMaxSize().background(c.background)) {
        SubBar("HX-AIOA 开发", "4 人 · 3 个 Agent", back = 3)
        Box(Modifier.weight(1f)) {
            Chat(Modifier.padding(top = 4.dp), dim = 2)
            Column(
                Modifier.offset(28.dp, 100.dp).width(320.dp).shadow(16.dp, RoundedCornerShape(16.dp)).clip(RoundedCornerShape(16.dp))
                    .background(c.popover).border(1.dp, c.border.copy(alpha = 0.6f), RoundedCornerShape(16.dp)).padding(10.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Act("copy", "复制"); Act("forward", "转发"); Act("star", "收藏"); Act("corner-up-left", "回复")
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Act("list-checks", "多选"); Act("sparkles", "精选"); Act("undo-2", "撤回"); Act("trash-2", "删除", c.danger)
                }
            }
        }
        Composer("发消息, 输入 @ 叫人或 Agent")
    }
}

@Composable
private fun Act(icon: String, label: String, tone: androidx.compose.ui.graphics.Color = Aioa.colors.text) {
    Column(Modifier.width(70.dp).clip(RoundedCornerShape(10.dp)).padding(vertical = 8.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Icon(icon, tone, 20.dp)
        Text(label, tone, 12)
    }
}

/** 多选: 每条前面打勾, 底部换成 逐条转发 / 合并转发 / 收藏 / 删除。 */
@Composable
fun MultiSelectDemo() {
    val c = Aioa.colors
    Column(Modifier.fillMaxSize().background(c.background)) {
        SubBar("已选 2 条", "", right = "x")
        Chat(Modifier.weight(1f).padding(top = 4.dp), select = true)
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.border.copy(alpha = 0.6f)))
        Row(Modifier.fillMaxWidth().background(c.sidebar).padding(horizontal = 12.dp, vertical = 10.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Act("forward", "逐条转发"); Act("layers", "合并转发"); Act("star", "收藏"); Act("trash-2", "删除", c.danger)
        }
    }
}

/** 合并转发后的样子: 一张 "聊天记录" 卡片 (前 4 条摘要); Agent 收到的也只是这张卡, 要细节再按引用去拉。 */
@Composable
fun ForwardDemo() {
    val c = Aioa.colors
    val pal = hxPalette()
    Column(Modifier.fillMaxSize().background(c.background)) {
        SubBar("家里服务器", "2 人 · 1 个 Agent", back = 3)
        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
            TimeChip("21:02", Modifier)
            Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.End)) {
                Column(
                    Modifier.widthIn(max = 260.dp).clip(RoundedCornerShape(16.dp, 4.dp, 16.dp, 16.dp)).background(c.surface)
                        .border(1.dp, c.border, RoundedCornerShape(16.dp, 4.dp, 16.dp, 16.dp)).padding(12.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Text("HX-AIOA 开发 的聊天记录", c.text, 15, weight = FontWeight.SemiBold)
                    listOf("小明: 新总览那套图表在低端机上会不会掉帧?", "oa_1: 图表全在 Canvas 里画, 数据不变不重组…", "Heng_Xin: 先把侧栏接进 App, 底栏去掉", "阿杰: 侧栏推开那个手感不错").forEach {
                        Text(it, c.textSecondary, 13)
                    }
                    Box(Modifier.padding(vertical = 4.dp).fillMaxWidth().height(1.dp).background(c.border.copy(alpha = 0.6f)))
                    Text("聊天记录 · 6 条", c.textSecondary, 12)
                }
                Initial("H", 40)
            }
            AgentMsg("nas 助手", pal.chart5, Modifier) {
                Text("收到 6 条聊天记录, 已按引用展开读完。要我把 \"侧栏接进 App\" 记成待办吗?", c.text, 15, maxLines = LONG)
            }
            Row(Modifier.padding(start = 50.dp, top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                LiveDot(pal.chart5, 6.dp)
                Text("nas 助手 正在输入…", pal.chart5, 12)
            }
        }
        Composer("发消息, 输入 @ 叫人或 Agent")
    }
}
