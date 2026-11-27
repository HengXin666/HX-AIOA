package com.hengxin.aioa.gallery

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.HomeSection
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.Initial
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.TreePath
import com.hengxin.aioa.kit.hxPalette
import com.hengxin.aioa.kit.pointerTap
import com.hengxin.aioa.kit.treeGuides

// 待办树: 就是带缩进的列表, 左边画连线 (每层竖线 + 圆角拐角), 一眼看出谁是谁的子任务。父子来自 parent 字段

private class Item(val title: String, val meta: String, val done: Boolean = false, val who: String = "", val agent: Boolean = false, val due: String = "", val kids: List<Item> = emptyList(), val shut: Boolean = false) {
    val total: Int get() = kids.sumOf { 1 + it.total }
    val doneCount: Int get() = kids.sumOf { (if (it.done) 1 else 0) + it.doneCount }
}

private val AIOA = listOf(
    Item("#121 安卓 UI 专项", "HX-AIOA · 大版本", who = "H", kids = listOf(
        Item("总览 v2", "图表 + 动效", who = "oa_1", agent = true, kids = listOf(
            Item("新外壳接入 App", "侧栏 + 顶部标签", done = true, who = "oa_1", agent = true),
            Item("今日脉搏接本地库", "0 请求", who = "oa_1", agent = true, due = "今天"),
            Item("开发 / 服务器并进顶部空间", "", who = "oa_1", agent = true),
        )),
        Item("消息页", "对齐 QQ", who = "H", kids = listOf(
            Item("会话页与输入栏", "表情第一", done = true, who = "H"),
            Item("域与标签", "chatFolders / chatTags", who = "小"),
            Item("合并转发卡片", "Agent 懒加载", kids = listOf(Item("服务端 bundle 字段", ""), Item("批量取消息", "")), shut = true),
        )),
        Item("CF 额度优化", "服务端", who = "oa_3", agent = true, kids = listOf(
            Item("已读拆表 + 帧带值", "省全端重拉", who = "oa_3", agent = true, due = "周日"),
            Item("成员分页与索引", "不设人数上限"),
        )),
    )),
    Item("#120 总览与群里看板统一入口", "HX-AIOA", due = "12-01"),
)

@Composable
fun TodoTreeDemo() {
    val c = Aioa.colors
    Column(Modifier.fillMaxSize().background(c.background)) {
        SubBar("点子待办", "13 条 · 已完成 2", right = "plus")
        Row(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            listOf("树" to true, "看板" to false, "按截止" to false).forEach { (s, on) ->
                Text(s, if (on) c.background else c.textSecondary, 13, Modifier.clip(RoundedCornerShape(9.dp)).background(if (on) c.text else c.surface).padding(horizontal = 14.dp, vertical = 6.dp), weight = FontWeight.Medium)
            }
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 14.dp)) {
            HomeSection("HX-AIOA", 11, action = "全部") { rows(AIOA, emptyList()) }
            HomeSection("wxv-ime", 1) { rows(listOf(Item("微信输入法移植", "卡在候选窗", due = "11-30")), emptyList()) }
        }
    }
}

@Composable
private fun rows(items: List<Item>, path: TreePath) {
    items.forEachIndexed { i, it -> Line(it, path + (i == items.lastIndex), first = path.isEmpty() && i == 0) }
}

@Composable
private fun Line(it: Item, path: TreePath, first: Boolean) {
    val c = Aioa.colors
    val pal = hxPalette()
    val lasts = path.drop(1)
    val parent = it.kids.isNotEmpty()
    Column(Modifier.fillMaxWidth().treeGuides(lasts, parent && !it.shut, c.textSecondary.copy(alpha = 0.45f), top = 9.5.dp)) {
        if (!first) Box(Modifier.fillMaxWidth().padding(start = (12 + lasts.size * 22).dp).height(0.5.dp).background(c.border))
        Row(Modifier.fillMaxWidth().pointerTap {}.padding(start = (12 + lasts.size * 22).dp, end = 12.dp, top = 9.dp, bottom = 9.dp), verticalAlignment = Alignment.Top) {
            Box(Modifier.size(20.dp), contentAlignment = Alignment.Center) {
                when {
                    parent -> Icon(if (it.shut) "chevron-right" else "chevron-down", c.textSecondary, 16.dp)
                    else -> Icon(if (it.done) "square-check" else "square", if (it.done) c.success else c.textSecondary, 19.dp)
                }
            }
            Column(Modifier.padding(start = 10.dp).weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(it.title, if (it.done) c.textSecondary else c.text, 14, weight = if (parent) FontWeight.SemiBold else FontWeight.Normal)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (it.due.isNotEmpty()) Text(it.due, if (it.due == "今天") c.warning else c.textSecondary, 11, weight = FontWeight.Medium)
                    if (it.meta.isNotEmpty()) Text(it.meta, c.textSecondary, 11)
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                if (it.who.isNotEmpty()) { if (it.agent) AgentFace(pal.chart2, 20) else Initial(it.who.take(1), 20, toneOf(3)) }
                if (parent) Text("${it.doneCount}/${it.total}", c.textSecondary, 11, Modifier.clip(RoundedCornerShape(6.dp)).background(c.surfaceAlt).padding(horizontal = 6.dp, vertical = 1.dp))
            }
        }
    }
    if (parent && !it.shut) rows(it.kids, path)
}
