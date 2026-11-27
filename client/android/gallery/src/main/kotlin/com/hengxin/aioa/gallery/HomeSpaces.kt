package com.hengxin.aioa.gallery

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.CheckBox
import com.hengxin.aioa.kit.CountChip
import com.hengxin.aioa.kit.Glyph
import com.hengxin.aioa.kit.HomeRow
import com.hengxin.aioa.kit.HomeSection
import com.hengxin.aioa.kit.HxButton
import com.hengxin.aioa.kit.HxButtonSize
import com.hengxin.aioa.kit.HxButtonVariant
import com.hengxin.aioa.kit.Initial
import com.hengxin.aioa.kit.ProgressLine
import com.hengxin.aioa.kit.SoftTag
import com.hengxin.aioa.kit.SpaceHeader
import com.hengxin.aioa.kit.Sparkline
import com.hengxin.aioa.kit.StatTile

// 各空间的示例内容, 只用组件库的分组与行 (插件区块也只能用这些)

@Composable
internal fun DailySpace() {
    val c = Aioa.colors
    SpaceHeader("周五 · 11 月 27 日", "2 件事等你决定", "2 个 Agent 在跑 · 3 条新消息")
    Row(Modifier.fillMaxWidth().padding(top = 14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        StatTile("message-circle", "3", "未读消息", Modifier.weight(1f))
        StatTile("bot", "2", "Agent 运行中", Modifier.weight(1f))
        StatTile("server", "2/2", "主机在线", Modifier.weight(1f))
    }
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
    HomeSection("正在发生", action = "Agent") {
        HomeRow("oa_1 · 新总览设计稿", "第 3 步 / 共 5 步: 渲染截图", "运行中", lead = { Glyph("bot") }) {
            ProgressLine(0.6f)
        }
        HomeRow("oa_3 · 插件私有源", "等待 CI: android.yml", "12 分钟", divider = true, lead = { Glyph("bot") }) {
            ProgressLine(0.3f)
        }
    }
    HomeSection("今日消息", action = "全部") {
        HomeRow("点子待办", "イデア: 已建 issue #121 安卓 UI 专项", "00:21", lead = { Initial("点", 36) }, end = { CountChip(2) })
        HomeRow("GitHub 动态", "HX-AIOA 推送 2 个提交到 main", "00:04", divider = true, lead = { Initial("G", 36) })
        HomeRow("福利", "Steam 冬促清单已更新, 3 个史低", "昨天", divider = true, lead = { Initial("福", 36) })
    }
    HomeSection("重点待办", 5, action = "看板") {
        HomeRow("总览与群里看板统一入口", "#120 · HX-AIOA · 今天", lead = { CheckBox(false) })
        HomeRow("安卓 UI 规范专项", "#121 · HX-AIOA · 今天", divider = true, lead = { CheckBox(false) })
    }
    HomeSection("值得一看") {
        HomeRow("Cloudflare: 账单已出", "11 月 $5.00, 自动扣款", "邮件", lead = { Glyph("mail") })
        HomeRow("Compose 1.8 发布说明", "共享元素转场稳定了", "信息流", divider = true, lead = { Glyph("flame") })
    }
}

@Composable
internal fun DevSpace() {
    val c = Aioa.colors
    SpaceHeader("开发 · HX-AIOA", "3 件事在进行", "2 个 Agent 任务 · 1 个 PR 等合并")
    HomeSection("Agent 任务", 2, action = "全部") {
        HomeRow("oa_1 · 新总览设计稿", "#121 · 第 3 / 5 步", "运行中", lead = { Glyph("bot") }) { ProgressLine(0.6f) }
        HomeRow("oa_3 · 插件私有源", "#118 · 等待 CI", "12 分钟", divider = true, lead = { Glyph("bot") }) { ProgressLine(0.3f) }
    }
    HomeSection("Pull Request", action = "GitHub") {
        HomeRow("#129 feat(plugin): 私有源", "oa_3 · +412 −37", "待合并", lead = { Glyph("git-pull-request", c.success) },
            end = { SoftTag("CI 通过", c.success) })
    }
    HomeSection("最近提交") {
        HomeRow("6dc65b0 Merge origin/main", "main · 部署成功", "02:01", lead = { Glyph("git-commit-horizontal") })
        HomeRow("baa6e34 同步 HX-UI 2.3.0", "android-ui · #121", "01:58", divider = true, lead = { Glyph("git-commit-horizontal") })
        HomeRow("android.yml 构建通过", "安卓 #123 已发布", "昨天", divider = true, lead = { Glyph("circle-check", c.success) })
    }
}

@Composable
internal fun ServerSpace() {
    val c = Aioa.colors
    SpaceHeader("服务器", "一切正常", "2 台在线 · 近 24 小时无告警")
    HomeSection("主机", 2) {
        Host("hx-pxy", "VPS · 东京", "CPU 18% · 内存 41%", listOf(12f, 15f, 14f, 22f, 18f, 16f, 19f, 18f, 21f, 17f), false)
        Host("nas-01", "家里 · 群晖", "CPU 6% · 58°C", listOf(5f, 7f, 6f, 9f, 6f, 5f, 7f, 6f, 8f, 6f), true)
    }
    HomeSection("hxoa", action = "插件") {
        HomeRow("vps-ai-dev", "workers 2 · 未提交 3", lead = { Glyph("terminal") }, end = { SoftTag("在线", c.success) })
        HomeRow("hx-laptop", "workers 1", divider = true, lead = { Glyph("terminal") }, end = { SoftTag("离线", c.textSecondary) })
    }
}

@Composable
private fun Host(name: String, where: String, now: String, trend: List<Float>, divider: Boolean) {
    val c = Aioa.colors
    HomeRow(name, "$where · $now", divider = divider, lead = { Glyph("server") }, end = { SoftTag("在线", c.success) }) {
        Sparkline(trend, Modifier.fillMaxWidth().height(30.dp))
    }
}

@Composable
internal fun TodoSpace() {
    SpaceHeader("点子待办", "5 条未完成", "今天 2 条 · 本周 3 条")
    HomeSection("记一笔") {
        HomeRow("记个点子…", "也可以在任意群里 @イデア", lead = { Glyph("lightbulb") })
    }
    HomeSection("HX-AIOA", 4, action = "看板") {
        HomeRow("总览与群里看板统一入口", "#120 · 今天", lead = { CheckBox(false) })
        HomeRow("安卓 UI 规范专项", "#121 · 今天", divider = true, lead = { CheckBox(false) })
        HomeRow("watch 先推进 head 导致 Agent 读空", "#114 · 11-26", divider = true, lead = { CheckBox(false) })
        HomeRow("插件市场支持私有源", "#118 · 昨天完成", divider = true, lead = { CheckBox(true) })
    }
    HomeSection("wxv-ime", 1) {
        HomeRow("微信输入法移植", "#3 · 11-26", lead = { CheckBox(false) })
    }
}
