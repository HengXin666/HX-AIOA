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
)

/** 侧栏顶部的固定入口 (总览, 消息, Agent, 资源)。 */
data class SideLink(val key: String, val title: String, val icon: String, val badge: Int = 0)

/** 侧栏 "最近" 里的一个群或会话。 */
data class SideRecent(val key: String, val title: String, val sub: String, val initial: String, val unread: Int = 0)

/** 点按, 不带缩放动效 (列表行用; 卡片才用 pressable)。 */
fun Modifier.pointerTap(onTap: () -> Unit): Modifier = this.then(
    Modifier.pointerInput(onTap) { detectTapGestures(onTap = { onTap() }) },
)

private val ROW_SHAPE = RoundedCornerShape(10.dp)
private const val MORE_KEY = "#more"

/** ChatGPT 式侧栏: 搜索 + 新建, 固定入口, 空间 (可编辑), 最近, 底部账号。 */
@Composable
fun HomeSidebar(
    links: List<SideLink>,
    spaces: List<HomeSpace>,
    recents: List<SideRecent>,
    selected: String,
    account: String,
    accountSub: String,
    onSelect: (String) -> Unit,
    onNew: () -> Unit,
    onEditSpaces: () -> Unit,
    onAccount: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = Aioa.colors
    Column(modifier.fillMaxSize().background(c.sidebar)) {
        Row(
            Modifier.fillMaxWidth().padding(start = 12.dp, end = 8.dp, top = 10.dp, bottom = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(
                Modifier.weight(1f).height(40.dp).clip(RoundedCornerShape(12.dp)).background(c.surface.copy(alpha = 0.7f))
                    .padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon("search", c.textSecondary, 17.dp)
                Text("搜索消息, 待办, 设置", c.textSecondary, 14)
            }
            Box(Modifier.size(40.dp).clip(RoundedCornerShape(12.dp)).pointerTap(onNew), contentAlignment = Alignment.Center) {
                Icon("square-pen", c.text, 20.dp)
            }
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 8.dp)) {
            links.forEach { SideRow(it.icon, it.title, it.badge, it.key == selected) { onSelect(it.key) } }
            SectionHead("空间", "编辑", onEditSpaces)
            val pinned = spaces.filter { it.pinned }
            pinned.forEach { s -> SpaceRow(s, s.id == selected) { onSelect(s.id) } }
            val rest = spaces.size - pinned.size
            if (rest > 0) SideRow("ellipsis", "更多空间 ($rest)", 0, false) { onSelect(MORE_KEY) }
            if (recents.isNotEmpty()) {
                SectionHead("最近", "", null)
                recents.forEach { r -> RecentRow(r, r.key == selected) { onSelect(r.key) } }
            }
            Spacer(Modifier.height(12.dp))
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.border.copy(alpha = 0.5f)))
        Row(
            Modifier.fillMaxWidth().pointerTap(onAccount).padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Initial(account.take(1), 32)
            Column(Modifier.weight(1f)) {
                Text(account, c.text, 15, weight = FontWeight.Medium)
                Text(accountSub, c.textSecondary, 12)
            }
            Icon("settings", c.textSecondary, 18.dp)
        }
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
private fun SideRow(icon: String, title: String, badge: Int, on: Boolean, onClick: () -> Unit) {
    val c = Aioa.colors
    Row(
        Modifier.fillMaxWidth().clip(ROW_SHAPE).background(if (on) c.surface else c.sidebar).pointerTap(onClick)
            .padding(horizontal = 10.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(icon, c.text, 19.dp)
        Text(title, c.text, 15, Modifier.weight(1f))
        if (badge > 0) Count(badge)
    }
}

@Composable
private fun SpaceRow(s: HomeSpace, on: Boolean, onClick: () -> Unit) {
    val c = Aioa.colors
    Row(
        Modifier.fillMaxWidth().clip(ROW_SHAPE).background(if (on) c.surface else c.sidebar).pointerTap(onClick)
            .padding(horizontal = 10.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(s.icon, c.text, 19.dp)
        Column(Modifier.weight(1f)) {
            Text(s.title, c.text, 15)
            if (s.hint.isNotEmpty()) Text(s.hint, c.textSecondary, 12)
        }
        if (s.plugin != null) Text("插件", c.textSecondary, 11, Modifier.clip(RoundedCornerShape(5.dp)).background(c.surfaceAlt).padding(horizontal = 5.dp, vertical = 1.dp))
        if (s.badge > 0) Count(s.badge)
    }
}

@Composable
private fun RecentRow(r: SideRecent, on: Boolean, onClick: () -> Unit) {
    val c = Aioa.colors
    Row(
        Modifier.fillMaxWidth().clip(ROW_SHAPE).background(if (on) c.surface else c.sidebar).pointerTap(onClick)
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Initial(r.initial, 24)
        Column(Modifier.weight(1f)) {
            Text(r.title, c.text, 14)
            Text(r.sub, c.textSecondary, 12)
        }
        if (r.unread > 0) Count(r.unread)
    }
}

@Composable
private fun Count(n: Int) {
    val c = Aioa.colors
    Text(if (n > 99) "99+" else n.toString(), c.textSecondary, 12, weight = FontWeight.Medium)
}

/** 头像占位: 首字, 圆形 (头像是唯一用正圆的地方)。 */
@Composable
fun Initial(text: String, sizeDp: Int) {
    val c = Aioa.colors
    Box(Modifier.size(sizeDp.dp).clip(CircleShape).background(c.surfaceAlt), contentAlignment = Alignment.Center) {
        Text(text, c.text, (sizeDp * 0.45f).toInt(), weight = FontWeight.Medium)
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

/** 底部输入条: 记点子或交给 Agent, ChatGPT 式全圆角胶囊。 */
@Composable
fun HomeComposer(placeholder: String, modifier: Modifier = Modifier) {
    val c = Aioa.colors
    Row(
        modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp).clip(RoundedCornerShape(50))
            .background(c.surface).border(1.dp, c.border, RoundedCornerShape(50)).padding(start = 8.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(Modifier.size(36.dp), contentAlignment = Alignment.Center) { Icon("plus", c.text, 20.dp) }
        Text(placeholder, c.textSecondary, 15, Modifier.weight(1f))
        Box(Modifier.size(36.dp), contentAlignment = Alignment.Center) { Icon("mic", c.text, 19.dp) }
        Box(
            Modifier.size(36.dp).clip(CircleShape).background(c.accent),
            contentAlignment = Alignment.Center,
        ) { Icon("arrow-up", c.onAccent, 19.dp) }
    }
}
