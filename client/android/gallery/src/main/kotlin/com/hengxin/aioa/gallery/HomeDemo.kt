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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.DropMenu
import com.hengxin.aioa.kit.HomeShell
import com.hengxin.aioa.kit.HxButton
import com.hengxin.aioa.kit.HxButtonSize
import com.hengxin.aioa.kit.HxButtonVariant
import com.hengxin.aioa.kit.HomeSidebar
import com.hengxin.aioa.kit.HomeSpace
import com.hengxin.aioa.kit.HomeTopBar
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.Initial
import com.hengxin.aioa.kit.MenuEntry
import com.hengxin.aioa.kit.SideLink
import com.hengxin.aioa.kit.SideRecent
import com.hengxin.aioa.kit.SpaceSwitcher
import com.hengxin.aioa.kit.SpaceTabs
import com.hengxin.aioa.kit.Sparkline
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.pointerTap
import com.hengxin.aioa.kit.rememberHomeShellState
import kotlinx.coroutines.launch

// 画廊用的假数据, 结构与真实总览一致
internal val DEMO_LINKS = listOf(
    SideLink("overview", "总览", "gauge"),
    SideLink("chat", "消息", "message-circle", 3),
    SideLink("agent", "Agent", "bot", 1),
    SideLink("res", "资源", "server"),
)
internal val DEMO_SPACES = listOf(
    HomeSpace("daily", "日常", "sun", "需要我 · 今日消息", 2),
    HomeSpace("dev", "开发", "code-xml", "Agent 任务 · GitHub", 3),
    HomeSpace("server", "服务器", "server", "2 台在线"),
    HomeSpace("todo", "点子待办", "lightbulb", "5 条未完成", 5),
    HomeSpace("mail", "邮件", "mail", "收件箱摘要", plugin = "hengxin666.mail", pinned = false),
    HomeSpace("feed", "信息流", "flame", "今日精选", plugin = "hengxin666.feed", pinned = false),
    HomeSpace("hxoa", "hxoa 工作区", "terminal", "3 个工作区", plugin = "hengxin666.hxoa", pinned = false),
)
internal val DEMO_RECENTS = listOf(
    SideRecent("g1", "点子待办", "イデア: 已建 issue #121", "点", 2),
    SideRecent("g2", "GitHub 动态", "HX-AIOA: 61a9db9 已部署", "G"),
    SideRecent("g3", "福利", "Steam 冬促清单", "福"),
)
internal val DEMO_MENU = listOf(
    MenuEntry("new-todo", "记个点子", "lightbulb"),
    MenuEntry("new-group", "新建群聊", "message-square-plus"),
    MenuEntry("join", "扫码 / 加入", "scan-line"),
    MenuEntry("agent", "接入 Agent", "bot"),
    MenuEntry("theme", "切换明暗", "moon", divider = true),
    MenuEntry("plugins", "插件市场", "puzzle"),
    MenuEntry("settings", "设置", "settings"),
)

/** 新总览: ChatGPT 式侧栏 + 顶栏空间切换 + 右上菜单。参数用于截图时固定状态。 */
@Composable
fun HomeDemo(start: String = "daily", drawer: Float = 0f, menu: Boolean = false, switcher: Boolean = false) {
    val shell = rememberHomeShellState(drawer)
    val scope = rememberCoroutineScope()
    var space by remember { mutableStateOf(start) }
    var menuOpen by remember { mutableStateOf(menu) }
    var switchOpen by remember { mutableStateOf(switcher) }
    val title = DEMO_SPACES.firstOrNull { it.id == space }?.title ?: "总览"
    val barPx = with(LocalDensity.current) { 52.dp.roundToPx() }
    HomeShell(shell, sidebar = {
        HomeSidebar(
            DEMO_LINKS, DEMO_SPACES, DEMO_RECENTS, space, "Heng_Xin", "主人 · 已连接",
            onSelect = { if (DEMO_SPACES.any { s -> s.id == it }) space = it; scope.launch { shell.close() } },
            onNew = {}, onEditSpaces = {}, onAccount = {},
        )
    }) {
        Column(Modifier.fillMaxSize()) {
            HomeTopBar(title, switchOpen, { scope.launch { shell.open() } }, { switchOpen = !switchOpen }, menuOpen, { menuOpen = !menuOpen })
            SpaceTabs(DEMO_SPACES.filter { it.pinned }, space, { space = it })
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
                when (space) {
                    "dev" -> DevSpace()
                    "server" -> ServerSpace()
                    "todo" -> TodoSpace()
                    else -> DailySpace()
                }
                Spacer(Modifier.height(16.dp))
            }
        }
        DropMenu(menuOpen, DEMO_MENU, { menuOpen = false }, { menuOpen = false }, offset = IntOffset(0, barPx), header = { MenuHeader() })
        SpaceSwitcher(switchOpen, DEMO_SPACES, space, { space = it; switchOpen = false }, { switchOpen = false }, { switchOpen = false }, IntOffset(0, barPx))
    }
}

@Composable
private fun Head(title: String, action: String = "") {
    val c = Aioa.colors
    Row(Modifier.fillMaxWidth().padding(top = 20.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(title, c.textSecondary, 13, Modifier.weight(1f), weight = FontWeight.Medium)
        if (action.isNotEmpty()) Text(action, c.textSecondary, 13)
    }
}

@Composable
private fun Item(lead: @Composable () -> Unit, title: String, sub: String, trail: String = "", extra: (@Composable () -> Unit)? = null) {
    val c = Aioa.colors
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).pointerTap {}.padding(vertical = 10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            lead()
            Column(Modifier.weight(1f)) {
                Text(title, c.text, 15, weight = FontWeight.Medium)
                Text(sub, c.textSecondary, 13)
            }
            if (trail.isNotEmpty()) Text(trail, c.textSecondary, 12)
        }
        extra?.invoke()
    }
}

@Composable
private fun Glyph(icon: String, tint: androidx.compose.ui.graphics.Color = Aioa.colors.text) {
    Box(Modifier.size(36.dp).clip(RoundedCornerShape(10.dp)).background(Aioa.colors.surface), contentAlignment = Alignment.Center) {
        Icon(icon, tint, 18.dp)
    }
}

@Composable
private fun DailySpace() {
    val c = Aioa.colors
    Head("需要我", "2")
    Item({ Glyph("bot", c.warning) }, "DSH 请求部署到生产", "镜像已推送, 健康检查通过", "1 分钟前") {
        Row(Modifier.padding(start = 48.dp, top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            HxButton("允许", {}, size = HxButtonSize.Sm)
            HxButton("先不", {}, variant = HxButtonVariant.Secondary, size = HxButtonSize.Sm)
        }
    }
    Item({ Glyph("mail") }, "GitHub: 有新的登录", "来自 Linux · Chrome, 不是你就去改密码", "8 分钟前")
    Head("今天", "全部消息")
    Item({ Initial("点", 36) }, "点子待办", "イデア: 已建 issue #121 安卓 UI 专项", "00:21")
    Item({ Initial("G", 36) }, "GitHub 动态", "HX-AIOA 推送 2 个提交到 main", "00:04")
    Item({ Initial("福", 36) }, "福利", "Steam 冬促清单已更新, 3 个史低", "昨天")
    Head("重点待办", "5")
    TodoRow("总览与群里看板统一入口", "#120 · HX-AIOA", false)
    TodoRow("安卓 UI 规范专项: 先改令牌与组件库", "#121 · HX-AIOA", false)
}

@Composable
private fun DevSpace() {
    Head("Agent 任务", "进行中 2")
    Item({ Glyph("bot") }, "oa_1 · 新总览侧栏", "第 3 步 / 共 5 步: 截图对比", "运行中")
    Item({ Glyph("bot") }, "oa_3 · 插件私有源", "等待 CI", "12 分钟")
    Head("GitHub", "HX-AIOA")
    Item({ Glyph("git-pull-request") }, "#121 [专项] 安卓 UI 与交互统一", "opened · 前端 · type: refactor", "00:05")
    Item({ Glyph("git-commit-horizontal") }, "61a9db9 docs(env): 环境变量总表", "main · 部署成功", "昨天")
    Item({ Glyph("circle-check", Aioa.colors.success) }, "android.yml 构建通过", "安卓 #123 已发布", "昨天")
}

@Composable
private fun ServerSpace() {
    Head("主机", "2 在线")
    Host("hx-pxy", "VPS · 东京", "CPU 18% · 内存 41%", listOf(12f, 15f, 14f, 22f, 18f, 16f, 19f, 18f))
    Host("nas-01", "家里 · 群晖", "CPU 6% · 58°C", listOf(5f, 7f, 6f, 9f, 6f, 5f, 7f, 6f))
    Head("hxoa", "插件")
    Item({ Glyph("terminal") }, "vps-ai-dev", "workers 2 · 未提交 3", "在线")
}

@Composable
private fun Host(name: String, where: String, now: String, trend: List<Float>) {
    Item({ Glyph("server") }, name, "$where · $now", "") {
        Sparkline(trend, Modifier.padding(start = 48.dp, top = 8.dp).fillMaxWidth().height(28.dp))
    }
}

@Composable
private fun TodoSpace() {
    Head("HX-AIOA", "4")
    TodoRow("总览与群里看板统一入口", "#120 · 今天", false)
    TodoRow("安卓 UI 规范专项", "#121 · 今天", false)
    TodoRow("插件市场支持私有源", "#118 · 昨天", true)
    TodoRow("watch 先推进 head 导致 Agent 读空", "#114 · 11-26", false)
    Head("wxv-ime", "1")
    TodoRow("微信输入法移植", "#3 · 11-26", false)
}

@Composable
private fun TodoRow(title: String, sub: String, done: Boolean) {
    val c = Aioa.colors
    Item({
        Box(Modifier.size(36.dp), contentAlignment = Alignment.Center) {
            Box(
                Modifier.size(18.dp).clip(RoundedCornerShape(5.dp)).background(if (done) c.text else c.background)
                    .border(1.5.dp, if (done) c.text else c.textSecondary, RoundedCornerShape(5.dp)),
                contentAlignment = Alignment.Center,
            ) { if (done) Icon("check", c.background, 13.dp) }
        }
    }, title, sub)
}

// 右上角菜单的标题区示例: 账号 + 连接状态
@Composable
private fun MenuHeader() {
    val c = Aioa.colors
    Row(Modifier.width(240.dp).padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Initial("H", 28)
        Column(Modifier.padding(start = 10.dp)) {
            Text("Heng_Xin", c.text, 14, weight = FontWeight.Medium)
            Text("aioa · 已连接", c.textSecondary, 12)
        }
    }
}
