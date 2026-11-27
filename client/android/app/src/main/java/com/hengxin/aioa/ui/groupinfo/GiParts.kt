package com.hengxin.aioa.ui.groupinfo

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
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
import com.hengxin.aioa.kit.FlatSwitch
import com.hengxin.aioa.kit.HomeRow
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.Panel
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.pointerTap

// 群聊设置 / 成员 / Agent 设置共用的小件, 照画廊 GroupInfoDemo 搬过来
internal const val ICON_NEXT = "chevron-right"
internal const val LINE_ALPHA = 0.5f
private val TILE = 52.dp

/** 群聊设置里叠的子页: 成员与 Agent, Agent 设置, 查找记录, 群文件, 精选。 */
sealed interface GsPage {
    data class Members(val agents: Boolean = false) : GsPage
    data class Agent(val keyId: String) : GsPage
    data object Search : GsPage
    data object Files : GsPage
    data object Picks : GsPage
}

/** 子页栈: 返回只退一级, 退到根就交给外层 (群会话)。 */
data class GsStack(val pages: List<GsPage> = emptyList()) {
    val top: GsPage? get() = pages.lastOrNull()
    val canBack: Boolean get() = pages.isNotEmpty()
    fun push(p: GsPage): GsStack = if (top == p) this else GsStack(pages + p)
    fun pop(): GsStack = GsStack(pages.dropLast(1))
}

/** 子页顶栏: 返回, 居中标题与小字, 右边可选圆形菜单钮。 */
@Composable
internal fun GiBar(title: String, sub: String, onBack: () -> Unit, right: String = "", onRight: () -> Unit = {}) {
    val c = Aioa.colors
    Column {
        Row(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(44.dp).clip(RoundedCornerShape(12.dp)).pointerTap(onBack), contentAlignment = Alignment.Center) {
                Icon("chevron-left", c.text, 24.dp)
            }
            Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(title, c.text, 17, weight = FontWeight.SemiBold)
                if (sub.isNotEmpty()) Text(sub, c.textSecondary, 12)
            }
            Box(Modifier.size(44.dp), contentAlignment = Alignment.Center) {
                if (right.isNotEmpty()) {
                    Box(
                        Modifier.size(36.dp).clip(CircleShape).background(c.surface).border(1.dp, c.border, CircleShape).pointerTap(onRight),
                        contentAlignment = Alignment.Center,
                    ) { Icon(right, c.text, 18.dp) }
                }
            }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.border.copy(alpha = 0.6f)))
    }
}

/** 子页骨架: 顶栏 + 可滚动的一列。 */
@Composable
internal fun GiPage(title: String, sub: String, onBack: () -> Unit, right: String = "", onRight: () -> Unit = {}, content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxSize().background(Aioa.colors.background)) {
        GiBar(title, sub, onBack, right, onRight)
        Column(Modifier.weight(1f).imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 14.dp)) {
            content()
            Spacer(Modifier.height(24.dp))
        }
    }
}

/** 资料行: 左标题, 右当前值 + 箭头; 不能改时不画箭头。 */
@Composable
internal fun GiValue(label: String, value: String, divider: Boolean, onClick: (() -> Unit)?) {
    val c = Aioa.colors
    HomeRow(label, divider = divider, onClick = onClick, end = {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            if (value.isNotEmpty()) Text(value, c.textSecondary, 14, Modifier.padding(start = 24.dp))
            if (onClick != null) Icon(ICON_NEXT, c.textSecondary, 14.dp)
        }
    })
}

@Composable
internal fun GiToggle(label: String, on: Boolean, divider: Boolean, sub: String = "", enabled: Boolean = true, set: (Boolean) -> Unit) {
    HomeRow(label, sub, divider = divider, onClick = { if (enabled) set(!on) }, end = { FlatSwitch(on, enabled, set) })
}

/** 危险操作行: 红字, 上面一道细线 (第一行不画)。 */
@Composable
internal fun GiDanger(label: String, divider: Boolean, onClick: () -> Unit) {
    val c = Aioa.colors
    Column(Modifier.fillMaxWidth().pointerTap(onClick)) {
        if (divider) Box(Modifier.padding(start = 14.dp).fillMaxWidth().height(1.dp).background(c.border.copy(alpha = LINE_ALPHA)))
        Text(label, c.danger, 15, Modifier.padding(14.dp), weight = FontWeight.Medium)
    }
}

@Composable
internal fun GiStat(n: Int, label: String, modifier: Modifier) {
    val c = Aioa.colors
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        CountUp(n, 22, c.text, delayMs = 200)
        Text(label, c.textSecondary, 12)
    }
}

/** 成员横排末尾的虚线框 "邀请"。 */
@Composable
internal fun InviteTile(onClick: () -> Unit) {
    val c = Aioa.colors
    val line = c.border
    Column(Modifier.width(60.dp).pointerTap(onClick), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(
            Modifier.size(TILE).drawBehind {
                drawRoundRect(line, cornerRadius = CornerRadius(14.dp.toPx()), style = Stroke(1.5.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 4.dp.toPx()))))
            },
            contentAlignment = Alignment.Center,
        ) { Icon("user-plus", c.textSecondary, 20.dp) }
        Text("邀请", c.textSecondary, 12)
    }
}

/** Agent 的头像: 圆角方块 + bot 图标 (Agent 不用正圆); 主人给这个来源 (sid) 设了图片头像 (#121) 就用图片, 同样圆角方块。 */
@Composable
internal fun AgentGlyph(tone: Color, size: Int = 36, sid: String? = null) {
    if (sid != null && com.hengxin.aioa.ui.chat.Senders.avatarOf(sid) != null) {
        com.hengxin.aioa.ui.chat.SenderFace(sid, "", size.dp, agent = true)
        return
    }
    Box(Modifier.size(size.dp).clip(RoundedCornerShape((size * 0.28f).dp)).background(tone.copy(alpha = 0.18f)), contentAlignment = Alignment.Center) {
        Icon("bot", tone, (size / 2).dp)
    }
}

@Composable
internal fun Quick(icon: String, label: String, modifier: Modifier, onClick: () -> Unit) {
    val c = Aioa.colors
    Panel(modifier.pointerTap(onClick)) {
        Column(Modifier.fillMaxWidth().padding(vertical = 14.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(icon, c.text, 20.dp)
            Text(label, c.textSecondary, 12)
        }
    }
}

/** 空状态或说明的一行小字。 */
@Composable
internal fun GiNote(text: String, color: Color = Aioa.colors.textSecondary) {
    Text(text, color, 13, Modifier.padding(horizontal = 14.dp, vertical = 12.dp), maxLines = 4)
}
