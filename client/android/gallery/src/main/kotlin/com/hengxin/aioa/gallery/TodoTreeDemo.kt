package com.hengxin.aioa.gallery

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.TreePath
import com.hengxin.aioa.kit.hxPalette
import com.hengxin.aioa.kit.pointerTap
import com.hengxin.aioa.kit.treeGuides

// 待办树: 一行一条的缩进列表 + 层级连线; 仓库分组带 GitHub 图标, 关联 issue 的带 issue 图标与编号,
// 父项带小进度条, 截止 / 星标 / 急 / 进行中压成右边的小标注。与 App 的 NodeRows 同一套布局

private class Item(
    val title: String,
    val issue: Int = 0,
    val closed: Boolean = false,
    val done: Boolean = false,
    val due: String = "",
    val hot: Boolean = false,
    val star: Boolean = false,
    val urgent: Boolean = false,
    val doing: Boolean = false,
    val kids: List<Item> = emptyList(),
    val shut: Boolean = false,
) {
    val total: Int get() = kids.sumOf { 1 + it.total }
    val doneCount: Int get() = kids.sumOf { (if (it.done) 1 else 0) + it.doneCount }
}

private val AIOA = listOf(
    Item("安卓 UI 与交互统一", issue = 121, doing = true, star = true, kids = listOf(
        Item("总览 v2", doing = true, kids = listOf(
            Item("新外壳接入 App", done = true),
            Item("今日脉搏接本地库", done = true),
            Item("开发 / 服务器并进顶部空间", due = "1 天", doing = true),
        )),
        Item("消息页对齐 QQ", kids = listOf(
            Item("会话页与输入栏", done = true),
            Item("域与标签", due = "3 天"),
            Item("合并转发卡片", kids = listOf(Item("bundle 字段"), Item("批量取消息")), shut = true),
        )),
        Item("CF 额度优化", issue = 131, urgent = true, kids = listOf(
            Item("已读拆表 + 帧带值", due = "5 小时", hot = true),
            Item("成员分页与索引"),
        )),
    )),
    Item("总览与群里看板统一入口", issue = 120, due = "4 天"),
    Item("插件市场支持私有源", issue = 118, closed = true, done = true),
)

private val IME = listOf(Item("候选窗跟随光标", issue = 3, kids = listOf(Item("获取光标坐标", done = true), Item("多屏幕边界", due = "逾期 1 天", hot = true))))

@Composable
fun TodoTreeDemo() {
    val c = Aioa.colors
    Column(Modifier.fillMaxSize().background(c.background)) {
        SubBar("点子待办", "16 条 · 已完成 6", right = "plus")
        Row(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            listOf("树" to true, "看板" to false, "按截止" to false).forEach { (s, on) ->
                Text(s, if (on) c.background else c.textSecondary, 13, Modifier.clip(RoundedCornerShape(9.dp)).background(if (on) c.text else c.surface).padding(horizontal = 14.dp, vertical = 6.dp), weight = FontWeight.Medium)
            }
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Group("HengXin666/HX-AIOA", 13, hxPalette().chart2, AIOA)
            Group("HengXin666/wxv-ime", 3, hxPalette().chart4, IME)
            Group("生活", 2, Color.Unspecified, listOf(Item("续费域名", due = "6 天", star = true), Item("给 NAS 换硬盘", doing = true)))
        }
    }
}

@Composable
private fun Group(name: String, n: Int, tone: Color, items: List<Item>) {
    val c = Aioa.colors
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(c.surface).border(1.dp, c.border.copy(alpha = 0.6f), RoundedCornerShape(16.dp))) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (tone == Color.Unspecified) Icon("layers", c.textSecondary, 15.dp) else Icon("github", tone, 15.dp)
            Text(name, c.text, 14, Modifier.weight(1f), weight = FontWeight.SemiBold)
            Text("$n", c.textSecondary, 12)
            Icon("chevron-down", c.textSecondary, 15.dp)
        }
        rows(items, emptyList())
    }
}

@Composable
private fun rows(items: List<Item>, path: TreePath) {
    items.forEachIndexed { i, it -> Line(it, path + (i == items.lastIndex)) }
}

@Composable
private fun Line(it: Item, path: TreePath) {
    val c = Aioa.colors
    val lasts = path.drop(1)
    val parent = it.kids.isNotEmpty()
    val start = (12 + lasts.size * 22).dp
    Column(Modifier.fillMaxWidth().treeGuides(lasts, parent && !it.shut, c.textSecondary.copy(alpha = 0.5f), marker = 18.dp, top = 8.5.dp)) {
        Box(Modifier.fillMaxWidth().padding(start = start).height(0.5.dp).background(c.border))
        Row(Modifier.fillMaxWidth().pointerTap {}.padding(start = start, end = 12.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.size(18.dp), contentAlignment = Alignment.Center) {
                if (parent) Icon(if (it.shut) "chevron-right" else "chevron-down", c.textSecondary, 15.dp)
                else Icon(if (it.done) "square-check" else "square", if (it.done) c.success else c.textSecondary, 17.dp)
            }
            if (it.issue > 0) Icon(if (it.closed) "circle-check" else "circle-dot", if (it.closed) Color(0xFF8250DF) else c.success, 14.dp)
            Text(it.title, if (it.done) c.textSecondary else c.text, 14, Modifier.weight(1f), weight = if (parent) FontWeight.SemiBold else FontWeight.Normal)
            Marks(it)
        }
    }
    if (parent && !it.shut) rows(it.kids, path)
}

@Composable
private fun Marks(it: Item) {
    val c = Aioa.colors
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        if (it.urgent && !it.done) Icon("flame", c.danger, 12.dp)
        if (it.star && !it.done) Icon("star", c.warning, 12.dp)
        if (it.doing && !it.done) Box(Modifier.size(6.dp).clip(RoundedCornerShape(2.dp)).background(c.accent))
        if (it.due.isNotEmpty() && !it.done) {
            val tone = if (it.hot) c.danger else c.accent
            Row(Modifier.clip(RoundedCornerShape(50)).background(tone.copy(alpha = 0.12f)).padding(horizontal = 6.dp, vertical = 1.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                Icon("clock", tone, 11.dp)
                Text(it.due, tone, 11, weight = FontWeight.SemiBold)
            }
        }
        if (it.issue > 0) Text("#${it.issue}", c.textSecondary, 11)
        if (it.kids.isNotEmpty()) {
            Box(Modifier.width(28.dp).height(4.dp).clip(RoundedCornerShape(50)).background(c.surfaceAlt)) {
                Box(Modifier.fillMaxWidth(it.doneCount.toFloat() / it.total).height(4.dp).clip(RoundedCornerShape(50)).background(if (it.doneCount == it.total) c.success else c.accent))
            }
            Text("${it.doneCount}/${it.total}", c.textSecondary, 11)
        }
    }
}
