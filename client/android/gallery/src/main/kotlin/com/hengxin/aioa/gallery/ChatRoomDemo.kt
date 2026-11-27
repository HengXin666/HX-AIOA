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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.Initial
import com.hengxin.aioa.kit.LiveDot
import com.hengxin.aioa.kit.ProgressLine
import com.hengxin.aioa.kit.SoftTag
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.enter
import com.hengxin.aioa.kit.hxPalette
import com.hengxin.aioa.kit.pointerTap

// 会话页设计稿: 结构照 QQ 手机版 (头像 + 名字 + 气泡, 引用在气泡顶, 输入框下一排功能钮), 视觉用 HX-UI ink

private val BUBBLE_MAX = 260.dp
private const val LONG = 40

/** 二级页顶栏: 返回 (带别处未读数), 标题 + 副标题, 右上圆钮。 */
@Composable
internal fun SubBar(title: String, sub: String, back: Int = 0, right: String = "ellipsis") {
    val c = Aioa.colors
    Column {
        Row(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Row(Modifier.clip(RoundedCornerShape(12.dp)).pointerTap {}.padding(horizontal = 6.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon("chevron-left", c.text, 24.dp)
                if (back > 0) Text("$back", c.textSecondary, 15)
            }
            Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(title, c.text, 17, weight = FontWeight.SemiBold)
                if (sub.isNotEmpty()) Text(sub, c.textSecondary, 12)
            }
            Box(Modifier.size(44.dp), contentAlignment = Alignment.Center) {
                if (right.isNotEmpty()) {
                    Box(
                        Modifier.size(36.dp).clip(androidx.compose.foundation.shape.CircleShape).background(c.surface)
                            .border(1.dp, c.border, androidx.compose.foundation.shape.CircleShape),
                        contentAlignment = Alignment.Center,
                    ) { Icon(right, c.text, 18.dp) }
                }
            }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.border.copy(alpha = 0.6f)))
    }
}

/** 群会话: 置顶公告, 真人与 Agent 混排, 系统提示, 引用, 任务进度, 正在输入。 */
@Composable
fun ChatRoomDemo() {
    val c = Aioa.colors
    val pal = hxPalette()
    Column(Modifier.fillMaxSize().background(c.background)) {
        SubBar("HX-AIOA 开发", "4 人 · 3 个 Agent", back = 3)
        Row(
            Modifier.fillMaxWidth().background(c.surface.copy(alpha = 0.6f)).padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon("megaphone", pal.chart3, 16.dp)
            Text("群公告: 下个大版本按 #121 总览 v2 实现", c.text, 13, Modifier.weight(1f))
            Icon("chevron-right", c.textSecondary, 14.dp)
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 12.dp)) {
            TimeChip("20:31", Modifier.enter(0))
            Msg("小明", "成员", pal.chart3, "新总览那套图表在低端机上会不会掉帧?", Modifier.enter(1))
            AgentMsg("oa_1", pal.chart2, Modifier.enter(2)) {
                Text("图表全在 Canvas 里画, 数据不变不重组; 入场 36 帧, 中端机实测前先按 60fps 设计。", c.text, 15, maxLines = LONG)
                Column(
                    Modifier.padding(top = 10.dp).fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(c.surfaceAlt).padding(10.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("#121 总览 v2 实现", c.text, 13, Modifier.weight(1f), weight = FontWeight.Medium)
                        Text("3 / 5", pal.chart2, 12, weight = FontWeight.Medium)
                    }
                    ProgressLine(0.6f)
                }
            }
            SysNote("oa_3 的指令已更新, 等它重新报到", Modifier.enter(3))
            Mine("先把侧栏接进 App, 底栏去掉", "oa_1: 图表全在 Canvas 里画…", Modifier.enter(4))
            Msg("阿杰", "管理员", pal.chart4, "侧栏推开那个手感不错", Modifier.enter(5))
            Row(Modifier.padding(start = 50.dp, top = 6.dp).enter(6), verticalAlignment = Alignment.CenterVertically) {
                LiveDot(pal.chart2, 6.dp)
                Text("oa_1 正在输入…", pal.chart2, 12)
            }
            Spacer(Modifier.height(12.dp))
        }
        Composer("发消息, 输入 @ 叫人或 Agent")
    }
}

/** 单聊: 只有两个真人, 没有 Agent (Agent 永远在群里)。 */
@Composable
fun DirectDemo() {
    val c = Aioa.colors
    val pal = hxPalette()
    Column(Modifier.fillMaxSize().background(c.background)) {
        SubBar("小明", "真人 · 在线")
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 12.dp)) {
            TimeChip("昨天 22:10", Modifier.enter(0))
            Msg("小明", "", pal.chart3, "周末那个 NAS 备份脚本你那边跑通了吗", Modifier.enter(1))
            Mine("跑通了, 每晚 3 点, 结果发到 家里服务器 群", "", Modifier.enter(2))
            TimeChip("20:40", Modifier.enter(3))
            Msg("小明", "", pal.chart3, "好, 我也进那个群看看", Modifier.enter(4))
            SysNote("单聊只有你们两个人; 想让 Agent 帮忙, 在群里 @ 它", Modifier.enter(5))
            Spacer(Modifier.height(12.dp))
        }
        Composer("发消息")
    }
}

@Composable
internal fun TimeChip(t: String, modifier: Modifier) {
    val c = Aioa.colors
    Box(modifier.fillMaxWidth().padding(vertical = 12.dp), contentAlignment = Alignment.Center) {
        Text(t, c.textSecondary, 12, Modifier.clip(RoundedCornerShape(8.dp)).background(c.surface).padding(horizontal = 10.dp, vertical = 3.dp))
    }
}

@Composable
internal fun SysNote(t: String, modifier: Modifier) {
    val c = Aioa.colors
    Box(modifier.fillMaxWidth().padding(vertical = 10.dp), contentAlignment = Alignment.Center) {
        Text(t, c.textSecondary, 12, Modifier.clip(RoundedCornerShape(8.dp)).background(c.surface).padding(horizontal = 10.dp, vertical = 4.dp))
    }
}

@Composable
private fun Who(name: String, role: String, tone: Color, agent: Boolean) {
    val c = Aioa.colors
    Row(Modifier.padding(bottom = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        if (role.isNotEmpty()) SoftTag(role, if (role == "成员") c.textSecondary else hxPalette().chart3)
        if (agent) SoftTag("Agent", tone)
        Text(name, c.textSecondary, 12)
    }
}

private fun bubbleShape(mine: Boolean) =
    if (mine) RoundedCornerShape(16.dp, 4.dp, 16.dp, 16.dp) else RoundedCornerShape(4.dp, 16.dp, 16.dp, 16.dp)

@Composable
internal fun Msg(name: String, role: String, tone: Color, text: String, modifier: Modifier) {
    val c = Aioa.colors
    Row(modifier.fillMaxWidth().padding(vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Initial(name.take(1), 40, tone)
        Column {
            Who(name, role, tone, false)
            Text(text, c.text, 15, Modifier.widthIn(max = BUBBLE_MAX).clip(bubbleShape(false)).background(c.surface).padding(horizontal = 12.dp, vertical = 9.dp), maxLines = LONG)
        }
    }
}

@Composable
internal fun AgentMsg(name: String, tone: Color, modifier: Modifier, body: @Composable () -> Unit) {
    val c = Aioa.colors
    Row(modifier.fillMaxWidth().padding(vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Box(Modifier.size(40.dp).clip(RoundedCornerShape(12.dp)).background(tone.copy(alpha = 0.18f)), contentAlignment = Alignment.Center) {
            Icon("bot", tone, 20.dp)
        }
        Column {
            Who(name, "", tone, true)
            Column(
                Modifier.widthIn(max = BUBBLE_MAX).clip(bubbleShape(false)).background(c.surface)
                    .border(1.dp, tone.copy(alpha = 0.35f), bubbleShape(false)).padding(12.dp),
            ) { body() }
        }
    }
}

@Composable
internal fun Mine(text: String, quote: String, modifier: Modifier) {
    val c = Aioa.colors
    Row(modifier.fillMaxWidth().padding(vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.End)) {
        Column(Modifier.widthIn(max = BUBBLE_MAX).clip(bubbleShape(true)).background(c.accent).padding(horizontal = 12.dp, vertical = 9.dp)) {
            if (quote.isNotEmpty()) {
                Row(
                    Modifier.padding(bottom = 6.dp).clip(RoundedCornerShape(6.dp)).background(c.onAccent.copy(alpha = 0.08f)).padding(horizontal = 8.dp, vertical = 4.dp),
                ) { Text(quote, c.onAccent.copy(alpha = 0.6f), 12) }
            }
            Text(text, c.onAccent, 15, maxLines = LONG)
        }
        Initial("H", 40)
    }
}

/** 输入栏 (对齐微信 / QQ): 左边切语音, 中间输入, 右边发送; 下面一排 表情, 图片, 拍照, 文件, 更多。@ 靠输入 "@" 或长按头像, 不占按钮。 */
@Composable
internal fun Composer(hint: String, text: String = "", voice: Boolean = false) {
    val c = Aioa.colors
    Column(Modifier.fillMaxWidth().background(c.sidebar)) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.border.copy(alpha = 0.6f)))
        Row(Modifier.padding(start = 8.dp, end = 12.dp, top = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.size(40.dp).clip(RoundedCornerShape(10.dp)).pointerTap {}, contentAlignment = Alignment.Center) {
                Icon(if (voice) "keyboard" else "mic", c.text, 22.dp)
            }
            if (voice) {
                Text("按住 说话", c.text, 15, Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).background(c.surfaceAlt).padding(vertical = 11.dp).wrapContentWidth(Alignment.CenterHorizontally), weight = FontWeight.SemiBold)
            } else {
                Text(text.ifEmpty { hint }, if (text.isEmpty()) c.textSecondary else c.text, 15, Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).background(c.surface).padding(horizontal = 14.dp, vertical = 11.dp))
                Text("发送", if (text.isEmpty()) c.textSecondary else c.onAccent, 14, Modifier.clip(RoundedCornerShape(12.dp)).background(if (text.isEmpty()) c.surface else c.accent).padding(horizontal = 14.dp, vertical = 10.dp), weight = FontWeight.SemiBold)
            }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 8.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            listOf("smile", "image", "camera", "folder", "plus").forEach {
                Box(Modifier.size(40.dp).clip(RoundedCornerShape(10.dp)).pointerTap {}, contentAlignment = Alignment.Center) { Icon(it, c.textSecondary, 22.dp) }
            }
        }
    }
}
