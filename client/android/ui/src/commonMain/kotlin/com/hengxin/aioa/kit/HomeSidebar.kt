package com.hengxin.aioa.kit

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTapGestures
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp

/**
 * 首页的一个 "空间": 日常, 开发, 服务器, 点子待办是内置的, 插件也可以加 (plugin 为插件 id)。
 * pinned 的出现在顶部切换条, 其余收进侧栏的 "更多"。
 */
data class HomeSpace(
    val id: String,
    val title: String,
    val icon: String,
    val hint: String = "",
    val badge: Int = 0,
    val plugin: String? = null,
    val pinned: Boolean = true,
    /** 插件空间对顶部标签的提示 (primary / auto / none), 内置页面为空。 */
    val tab: String? = null,
)

/** 侧栏里的固定入口 (消息, Agent, 资源...) 或底部工具钮。 */
data class SideLink(val key: String, val title: String, val icon: String, val badge: Int = 0)

/** 侧栏 "最近" 里的一个群或会话。 */
data class SideRecent(val key: String, val title: String, val sub: String, val initial: String, val unread: Int = 0)

/** 侧栏头部的账号: 名字, 连的服务端, 是否在线。 */
/** 侧栏账号头 (#139): 我的头像与昵称, 下面一行连接状态与服务器; avatar 为空时用昵称首字。 */
data class SideAccount(val name: String, val server: String, val online: Boolean, val avatar: (@Composable () -> Unit)? = null)

/** 点按, 不带缩放动效 (列表行用; 卡片才用 pressable)。 */
fun Modifier.pointerTap(onTap: () -> Unit): Modifier = this.then(
    Modifier.pointerInput(onTap) { detectTapGestures(onTap = { onTap() }) },
)

private val ROW_SHAPE = RoundedCornerShape(10.dp)
private const val MORE_KEY = "#more"

/** Telegram 结构 + ChatGPT 样子的侧栏: 账号头, 搜索, 固定入口, 空间 (可编辑), 最近, 底部工具钮。 */
@Composable
fun HomeSidebar(
    account: SideAccount,
    links: List<SideLink>,
    spaces: List<HomeSpace>,
    recents: List<SideRecent>,
    tools: List<SideLink>,
    selected: String,
    onSelect: (String) -> Unit,
    onEditSpaces: () -> Unit,
    onAccount: () -> Unit,
    modifier: Modifier = Modifier,
    // 点搜索框 (#139): 打开搜索页; 为 null 时搜索框只是摆设 (画廊)
    onSearch: (() -> Unit)? = null,
) {
    val c = Aioa.colors
    Column(modifier.fillMaxSize().background(c.sidebar)) {
        AccountHead(account, onAccount)
        Row(
            Modifier.padding(horizontal = 12.dp, vertical = 6.dp).fillMaxWidth().height(40.dp).clip(RoundedCornerShape(12.dp))
                .background(c.surface).then(if (onSearch != null) Modifier.pointerTap(onSearch) else Modifier).padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon("search", c.textSecondary, 17.dp)
            Text("搜索群, 会话与消息", c.textSecondary, 14)
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 8.dp, vertical = 4.dp)) {
            links.forEach { SideRow(it.icon, it.title, it.badge, it.key == selected) { onSelect(it.key) } }
            SectionHead("空间", "编辑", onEditSpaces)
            val pinned = spaces.filter { it.pinned }
            pinned.forEach { s -> SpaceRow(s, s.id == selected) { onSelect(s.id) } }
            val rest = spaces.size - pinned.size
            if (rest > 0) SideRow("layers", "更多空间", rest, false, muted = true) { onSelect(MORE_KEY) }
            if (recents.isNotEmpty()) {
                SectionHead("最近", "", null)
                recents.forEach { r -> RecentRow(r, r.key == selected) { onSelect(r.key) } }
            }
            Spacer(Modifier.height(12.dp))
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.border.copy(alpha = 0.5f)))
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            tools.forEach { t ->
                Row(
                    Modifier.weight(1f).height(40.dp).clip(ROW_SHAPE).pointerTap { onSelect(t.key) },
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
                ) {
                    Icon(t.icon, c.textSecondary, 17.dp)
                    Text(t.title, c.textSecondary, 13)
                }
            }
        }
    }
}

@Composable
private fun AccountHead(a: SideAccount, onClick: () -> Unit) {
    val c = Aioa.colors
    Row(
        Modifier.fillMaxWidth().padding(start = 8.dp, end = 8.dp, top = 14.dp, bottom = 6.dp).clip(RoundedCornerShape(12.dp))
            .pointerTap(onClick).padding(horizontal = 8.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        a.avatar?.invoke() ?: Initial(a.name.take(1), 40)
        Column(Modifier.weight(1f)) {
            Text(a.name, c.text, 16, weight = FontWeight.SemiBold)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Box(Modifier.size(7.dp).clip(CircleShape).background(if (a.online) c.success else c.textSecondary))
                Text(listOf(if (a.online) "已连接" else "未连接", a.server).filter { it.isNotEmpty() }.joinToString(" · "), c.textSecondary, 12, maxLines = 1)
            }
        }
        Icon("chevrons-up-down", c.textSecondary, 16.dp)
    }
}

@Composable
private fun SectionHead(title: String, action: String, onAction: (() -> Unit)?) {
    val c = Aioa.colors
    Row(Modifier.fillMaxWidth().padding(start = 10.dp, end = 6.dp, top = 18.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(title, c.textSecondary, 13, Modifier.weight(1f), weight = FontWeight.Medium)
        if (onAction != null) Text(action, c.textSecondary, 13, Modifier.clip(ROW_SHAPE).pointerTap(onAction).padding(4.dp))
    }
}

@Composable
private fun SideRow(icon: String, title: String, badge: Int, on: Boolean, muted: Boolean = false, onClick: () -> Unit) {
    val c = Aioa.colors
    val tint = if (muted) c.textSecondary else c.text
    Row(
        Modifier.fillMaxWidth().clip(ROW_SHAPE).background(if (on) c.surface else c.sidebar).pointerTap(onClick)
            .padding(horizontal = 10.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(icon, tint, 19.dp)
        Text(title, tint, 15, Modifier.weight(1f))
        if (badge > 0) CountChip(badge)
    }
}

@Composable
private fun SpaceRow(s: HomeSpace, on: Boolean, onClick: () -> Unit) {
    val c = Aioa.colors
    Row(
        Modifier.fillMaxWidth().clip(ROW_SHAPE).background(if (on) c.surface else c.sidebar).pointerTap(onClick)
            .padding(horizontal = 8.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(
            Modifier.size(30.dp).clip(RoundedCornerShape(8.dp)).background(if (on) c.surfaceAlt else c.surface),
            contentAlignment = Alignment.Center,
        ) { Icon(s.icon, c.text, 16.dp) }
        Column(Modifier.weight(1f)) {
            Text(s.title, c.text, 15)
            if (s.hint.isNotEmpty()) Text(s.hint, c.textSecondary, 12)
        }
        if (s.plugin != null) Text("插件", c.textSecondary, 11, Modifier.clip(RoundedCornerShape(5.dp)).background(c.surfaceAlt).padding(horizontal = 5.dp, vertical = 1.dp))
        if (s.badge > 0) CountChip(s.badge)
    }
}

@Composable
private fun RecentRow(r: SideRecent, on: Boolean, onClick: () -> Unit) {
    val c = Aioa.colors
    Row(
        Modifier.fillMaxWidth().clip(ROW_SHAPE).background(if (on) c.surface else c.sidebar).pointerTap(onClick)
            .padding(horizontal = 9.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(11.dp),
    ) {
        Initial(r.initial, 28)
        Column(Modifier.weight(1f)) {
            Text(r.title, c.text, 14)
            Text(r.sub, c.textSecondary, 12)
        }
        if (r.unread > 0) CountChip(r.unread)
    }
}

/** 头像占位: 首字, 圆形 (头像是唯一用正圆的地方)。 */
@Composable
fun Initial(text: String, sizeDp: Int, tint: androidx.compose.ui.graphics.Color? = null) {
    val c = Aioa.colors
    val bg = tint?.copy(alpha = 0.18f) ?: c.surfaceAlt
    Box(Modifier.size(sizeDp.dp).clip(CircleShape).background(bg), contentAlignment = Alignment.Center) {
        Text(text, tint ?: c.text, (sizeDp * 0.45f).toInt(), weight = FontWeight.Medium)
    }
}

/** 点中间标题弹出的空间切换 (ChatGPT 的模型选择): 每项有说明, 当前项打勾, 底部管理入口。 */
@Composable
fun SpaceSwitcher(
    visible: Boolean,
    spaces: List<HomeSpace>,
    selected: String,
    onPick: (String) -> Unit,
    onManage: () -> Unit,
    onDismiss: () -> Unit,
    offset: IntOffset,
) {
    val entries = spaces.map { MenuEntry(it.id, it.title, it.icon, hint = if (it.id == selected) "✓" else it.plugin?.let { "插件" } ?: "") } +
        MenuEntry(MANAGE_KEY, "管理空间与排序", "sliders-horizontal", divider = true)
    DropMenu(
        visible = visible,
        entries = entries,
        onPick = { if (it.key == MANAGE_KEY) onManage() else onPick(it.key) },
        onDismiss = onDismiss,
        alignment = Alignment.TopCenter,
        offset = offset,
        width = 280.dp,
    )
}

private const val MANAGE_KEY = "#manage"

/** 底部输入条: 记点子或交给 Agent, 圆角矩形, 发送键是圆角方块 (不用正圆)。 */
@Composable
fun HomeComposer(placeholder: String, modifier: Modifier = Modifier) {
    val c = Aioa.colors
    Row(
        modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp).clip(RoundedCornerShape(22.dp))
            .background(c.surface).border(1.dp, c.border, RoundedCornerShape(22.dp)).padding(start = 8.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(Modifier.size(36.dp), contentAlignment = Alignment.Center) { Icon("plus", c.text, 20.dp) }
        Text(placeholder, c.textSecondary, 15, Modifier.weight(1f))
        Box(Modifier.size(36.dp), contentAlignment = Alignment.Center) { Icon("mic", c.text, 19.dp) }
        Box(
            Modifier.size(36.dp).clip(RoundedCornerShape(12.dp)).background(c.accent),
            contentAlignment = Alignment.Center,
        ) { Icon("arrow-up", c.onAccent, 19.dp) }
    }
}
