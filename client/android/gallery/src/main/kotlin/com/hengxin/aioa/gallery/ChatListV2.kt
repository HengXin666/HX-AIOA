package com.hengxin.aioa.gallery

import androidx.compose.foundation.background
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
import com.hengxin.aioa.kit.CountChip
import com.hengxin.aioa.kit.HomeTopBar
import com.hengxin.aioa.kit.SpaceTabs
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.Initial
import com.hengxin.aioa.kit.SoftTag
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.enter
import com.hengxin.aioa.kit.hxPalette
import com.hengxin.aioa.kit.pointerTap

// 消息列表 v2: 只有一列; 置顶多了折叠; "域" 是列表里的一行 (点进去是一组群, 像 QQ 的群助手);
// 顶上一排是 "标签" (企业微信式, 人和群都能打), 只做筛选

internal data class Row2(
    val name: String,
    val preview: String,
    val time: String,
    val initial: String,
    val tone: Int,
    val unread: Int = 0,
    val agents: Int = 0,
    val person: Boolean = false,
    val typing: Boolean = false,
    val muted: Boolean = false,
    val domain: Int = 0,
)

private val PINNED = listOf(
    Row2("DSH 运维", "DSH: 镜像已推送, 等你确认部署", "20:49", "D", 4, unread = 1, agents = 1),
    Row2("小明", "好, 我也进那个群看看", "20:40", "小", 3, person = true),
)
private val REST = listOf(
    Row2("开发", "HX-AIOA 开发: oa_1 正在输入…", "20:48", "开", 2, unread = 3, domain = 5, typing = true),
    Row2("点子待办", "イデア: 已建 issue #121 安卓 UI 专项", "00:21", "点", 3, unread = 2, agents = 1),
    Row2("家里服务器", "nas-01: 夜间备份完成, 用时 14 分钟", "昨天", "家", 5, agents = 1),
    Row2("生活", "福利: Steam 冬促清单已更新", "昨天", "生", 4, domain = 3, muted = true),
    Row2("阿杰", "侧栏推开那个手感不错", "周三", "阿", 4, person = true),
    Row2("备忘", "[图片] 门禁卡照片", "周二", "备", 1, person = true),
)

@Composable
internal fun toneOf(i: Int): Color {
    val p = hxPalette()
    return listOf(p.chart1, p.chart2, p.chart3, p.chart4, p.chart5)[(i - 1).coerceIn(0, 4)]
}

@Composable
fun ChatListV2() {
    val c = Aioa.colors
    Column(Modifier.fillMaxSize().background(c.background)) {
        HomeDemoBars("chat")
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 14.dp)) {
            Row(Modifier.padding(top = 12.dp, bottom = 4.dp).enter(0), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon("tag", c.textSecondary, 15.dp)
                listOf("全部" to true, "工作" to false, "家人" to false, "未读 6" to false).forEach { (t, on) ->
                    Text(t, if (on) c.background else c.textSecondary, 13, Modifier.clip(RoundedCornerShape(9.dp)).background(if (on) c.text else c.surface).padding(horizontal = 12.dp, vertical = 6.dp), weight = FontWeight.Medium)
                }
            }
            PINNED.forEachIndexed { i, r -> ConvRow(r, pinned = true, divider = i > 0, modifier = Modifier.enter(i + 1)) }
            Row(
                Modifier.fillMaxWidth().padding(vertical = 4.dp).clip(RoundedCornerShape(10.dp)).background(c.surface).pointerTap {}.padding(horizontal = 12.dp, vertical = 9.dp).enter(3),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon("pin", c.textSecondary, 14.dp)
                Text("还有 4 个置顶已折叠", c.textSecondary, 13, Modifier.weight(1f))
                Icon("chevron-down", c.textSecondary, 14.dp)
            }
            REST.forEachIndexed { i, r -> ConvRow(r, pinned = false, divider = i > 0, modifier = Modifier.enter(i + 4)) }
        }
    }
}

/** 域里面: 还是同样的会话行, 顶栏写 "域 · n 个群"。 */
@Composable
fun DomainDemo() {
    val c = Aioa.colors
    Column(Modifier.fillMaxSize().background(c.background)) {
        SubBar("开发", "域 · 5 个群 · 3 条未读")
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 14.dp)) {
            listOf(
                Row2("HX-AIOA 开发", "oa_1 正在输入…", "20:48", "H", 2, unread = 2, agents = 3, typing = true),
                Row2("HX-UI", "Heng_Xin: PR #52 等 CI", "19:02", "U", 4, agents = 1),
                Row2("GitHub 动态", "HX-AIOA 推送 2 个提交到 main", "00:04", "G", 5, unread = 1),
                Row2("wxv-ime", "微信输入法移植: 卡在候选窗", "周一", "W", 3),
                Row2("Kotlin 群", "Compose 1.8 的共享元素有人用了吗", "周三", "K", 4, muted = true),
            ).forEachIndexed { i, r -> ConvRow(r, pinned = false, divider = i > 0, modifier = Modifier.padding(top = if (i == 0) 6.dp else 0.dp).enter(i)) }
            Text("长按群可移出这个域; 一个群只在一个域里, 标签可以打多个。", c.textSecondary, 12, Modifier.padding(vertical = 16.dp), maxLines = 3)
        }
    }
}

@Composable
private fun DomainAvatar(tone: Color) {
    val c = Aioa.colors
    Box(Modifier.size(52.dp)) {
        Box(Modifier.size(40.dp).offset(10.dp, 0.dp).clip(RoundedCornerShape(11.dp)).background(tone.copy(alpha = 0.12f)))
        Box(Modifier.size(44.dp).offset(0.dp, 8.dp).clip(RoundedCornerShape(12.dp)).background(c.surfaceAlt), contentAlignment = Alignment.Center) {
            Icon("layers", tone, 20.dp)
        }
    }
}

@Composable
internal fun ConvRow(r: Row2, pinned: Boolean, divider: Boolean, modifier: Modifier = Modifier) {
    val c = Aioa.colors
    val tone = toneOf(r.tone)
    Column(modifier.fillMaxWidth().pointerTap {}) {
        if (divider) Box(Modifier.padding(start = 64.dp).fillMaxWidth().height(1.dp).background(c.border.copy(alpha = 0.5f)))
        Row(Modifier.padding(vertical = 11.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            if (r.domain > 0) DomainAvatar(tone) else Initial(r.initial, 52, tone)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(r.name, c.text, 16, weight = FontWeight.SemiBold)
                    if (r.domain > 0) SoftTag("域 · ${r.domain}", tone)
                    if (r.agents > 0) SoftTag("${r.agents} Agent", hxPalette().chart2)
                    if (r.muted) Icon("bell-off", c.textSecondary, 13.dp)
                    Spacer(Modifier.weight(1f))
                    Text(r.time, c.textSecondary, 12)
                }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(r.preview, if (r.typing) hxPalette().chart2 else c.textSecondary, 14, Modifier.weight(1f))
                    when {
                        r.unread > 0 -> CountChip(r.unread, strong = !r.muted)
                        pinned -> Icon("pin", c.textSecondary, 14.dp)
                    }
                }
            }
        }
    }
}

@Composable
private fun HomeDemoBars(sel: String) {
    HomeTopBar(DEMO_SPACES.first { it.id == sel }.title, false, {}, {}, false, {}, dot = true)
    SpaceTabs(DEMO_SPACES.filter { it.pinned }, sel, {})
}
