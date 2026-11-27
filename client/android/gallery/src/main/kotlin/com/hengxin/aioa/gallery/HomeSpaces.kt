package com.hengxin.aioa.gallery

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.CheckBox
import com.hengxin.aioa.kit.Glyph
import com.hengxin.aioa.kit.HomeRow
import com.hengxin.aioa.kit.HomeSection
import com.hengxin.aioa.kit.ProgressLine
import com.hengxin.aioa.kit.SoftTag
import com.hengxin.aioa.kit.SpaceHeader
import com.hengxin.aioa.kit.Panel
import com.hengxin.aioa.kit.SectionTitle
import com.hengxin.aioa.kit.hxPalette

// 各空间的示例内容, 只用组件库的分组与行 (插件区块也只能用这些)

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
    val pal = hxPalette()
    SpaceHeader("服务器", "一切正常", "2 台在线 · 近 24 小时无告警")
    SectionTitle("主机", 2)
    Panel(Modifier.fillMaxWidth()) {
        HostBlock("hx-pxy", "VPS · 东京", 0.18f, 0.41f, listOf(12f, 15f, 14f, 22f, 18f, 16f, 19f, 18f, 24f, 17f, 20f), pal.chart2)
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.border.copy(alpha = 0.5f)))
        HostBlock("nas-01", "家里 · 群晖", 0.06f, 0.58f, listOf(5f, 7f, 6f, 9f, 6f, 5f, 7f, 6f, 8f, 6f, 7f), pal.chart5)
    }
    HomeSection("hxoa", action = "插件") {
        HomeRow("vps-ai-dev", "workers 2 · 未提交 3", lead = { Glyph("terminal") }, end = { SoftTag("在线", c.success) })
        HomeRow("hx-laptop", "workers 1", divider = true, lead = { Glyph("terminal") }, end = { SoftTag("离线", c.textSecondary) })
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
