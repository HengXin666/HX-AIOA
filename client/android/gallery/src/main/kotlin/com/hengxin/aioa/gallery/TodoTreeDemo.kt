package com.hengxin.aioa.gallery

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.HxButton
import com.hengxin.aioa.kit.HxButtonSize
import com.hengxin.aioa.kit.HxButtonVariant
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.Initial
import com.hengxin.aioa.kit.ProgressLine
import com.hengxin.aioa.kit.SoftTag
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.TreeGraph
import com.hengxin.aioa.kit.TreeNode
import com.hengxin.aioa.kit.TreeSpot
import com.hengxin.aioa.kit.hxPalette
import com.hengxin.aioa.kit.pointerTap

// 待办树: 真正的树图 (节点 + 连出来的边), 不是缩进列表。父子来自待办的 parent 字段, 不加存储

internal enum class St { DONE, DOING, TODO }

internal data class Todo(val title: String, val sub: String, val st: St, val who: String = "", val agent: Boolean = false, val hidden: Int = 0, val done: Int = 0, val all: Int = 0)

private fun t(key: String, v: Todo, vararg kids: TreeNode<Todo>, collapsed: Boolean = false) = TreeNode(key, v, kids.toList(), collapsed)

private val TREE = listOf(
    t("121", Todo("#121 安卓 UI 专项", "HX-AIOA · 大版本", St.DOING, done = 5, all = 11),
        t("a", Todo("总览 v2", "图表 + 动效", St.DOING, "oa_1", true, done = 2, all = 4),
            t("a1", Todo("新外壳接入 App", "侧栏 + 顶部标签", St.DONE, "oa_1", true)),
            t("a2", Todo("今日脉搏接本地库", "0 请求", St.DOING, "oa_1", true)),
            t("a3", Todo("插件区块", "", St.TODO), collapsed = true).let { it.copy(value = it.value.copy(hidden = 2)) },
        ),
        t("b", Todo("消息页", "对齐 QQ", St.DOING, "H", done = 1, all = 3),
            t("b1", Todo("会话页与输入栏", "表情第一", St.DONE, "H")),
            t("b2", Todo("域与标签", "chatFolders / chatTags", St.TODO, "小")),
            t("b3", Todo("合并转发卡片", "Agent 懒加载", St.TODO)),
        ),
        t("c", Todo("CF 额度优化", "服务端", St.TODO, "oa_3", true, all = 2),
            t("c1", Todo("已读拆表 + 帧带值", "省全端重拉", St.TODO, "oa_3", true)),
            t("c2", Todo("成员分页与索引", "不设人数上限", St.TODO)),
        ),
        t("d", Todo("待办树", "本页", St.DONE, "H")),
    ),
)

@Composable
private fun stColor(st: St): Color {
    val c = Aioa.colors
    return when (st) {
        St.DONE -> c.success
        St.DOING -> hxPalette().chart2
        St.TODO -> c.textSecondary
    }
}

@Composable
fun TodoTreeDemo(selected: String = "", scale: Float = 0.56f, panX: Float = 42f, panY: Float = 120f) {
    val c = Aioa.colors
    val edgeDone = c.success.copy(alpha = 0.7f)
    val edgeOpen = c.border
    Column(Modifier.fillMaxSize().background(c.background)) {
        SubBar("待办树", "HX-AIOA · 12 条 · 已完成 5", right = "plus")
        Row(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            listOf("树" to true, "看板" to false, "列表" to false).forEach { (s, on) ->
                Text(s, if (on) c.background else c.textSecondary, 13, Modifier.clip(RoundedCornerShape(9.dp)).background(if (on) c.text else c.surface).padding(horizontal = 14.dp, vertical = 6.dp), weight = FontWeight.Medium)
            }
            Box(Modifier.weight(1f))
            Text("隐藏已完成", c.textSecondary, 13)
            FlatSwitch(false)
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            TreeGraph(
                TREE, Modifier.fillMaxSize(), start = Offset(panX, panY), scale = scale,
                edge = { if (it.st == St.DONE) edgeDone else edgeOpen },
            ) { s -> TodoCard(s, s.node.key == selected) }
            Column(Modifier.align(Alignment.BottomEnd).padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("plus", "minus", "maximize-2").forEach { ic ->
                    Box(Modifier.size(40.dp).clip(RoundedCornerShape(12.dp)).background(c.surface).border(1.dp, c.border, RoundedCornerShape(12.dp)).pointerTap {}, contentAlignment = Alignment.Center) {
                        Icon(ic, c.text, 18.dp)
                    }
                }
            }
            if (selected.isNotEmpty()) Detail(Modifier.align(Alignment.BottomCenter))
        }
    }
}

@Composable
private fun TodoCard(s: TreeSpot<Todo>, on: Boolean) {
    val c = Aioa.colors
    val v = s.node.value
    val tone = stColor(v.st)
    val shape = RoundedCornerShape(14.dp)
    Row(
        Modifier.fillMaxSize().clip(shape).background(if (s.depth == 0) c.surfaceAlt else c.surface)
            .border(if (on) 1.5.dp else 1.dp, if (on) c.text else c.border.copy(alpha = 0.7f), shape),
    ) {
        Box(Modifier.width(4.dp).fillMaxHeight().background(tone))
        Column(Modifier.weight(1f).padding(start = 10.dp, end = 8.dp, top = 8.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Mark(v.st)
                Text(v.title, if (v.st == St.DONE) c.textSecondary else c.text, 14, Modifier.weight(1f), weight = FontWeight.SemiBold)
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                if (v.all > 0) Text("${v.done}/${v.all}", tone, 11, weight = FontWeight.SemiBold)
                Text(v.sub, c.textSecondary, 11, Modifier.weight(1f))
                if (v.hidden > 0) Text("+${v.hidden}", c.text, 11, Modifier.clip(RoundedCornerShape(5.dp)).background(c.surfaceAlt).padding(horizontal = 5.dp, vertical = 1.dp), weight = FontWeight.SemiBold)
                if (v.who.isNotEmpty()) {
                    if (v.agent) AgentFace(hxPalette().chart2, 18) else Initial(v.who.take(1), 18, toneOf(3))
                }
            }
        }
    }
}

@Composable
private fun Mark(st: St) {
    val c = Aioa.colors
    val tone = stColor(st)
    Box(
        Modifier.size(14.dp).clip(RoundedCornerShape(4.dp)).background(if (st == St.DONE) tone else Color.Transparent)
            .border(1.5.dp, tone, RoundedCornerShape(4.dp)),
        contentAlignment = Alignment.Center,
    ) {
        when (st) {
            St.DONE -> Icon("check", c.background, 10.dp)
            St.DOING -> Box(Modifier.size(6.dp).clip(RoundedCornerShape(2.dp)).background(tone))
            St.TODO -> {}
        }
    }
}

// 选中节点: 底部浮出详情, 子任务进度, 常用操作
@Composable
private fun Detail(modifier: Modifier) {
    val c = Aioa.colors
    val pal = hxPalette()
    Column(
        modifier.fillMaxWidth().clip(RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp)).background(c.popover)
            .border(1.dp, c.border.copy(alpha = 0.6f), RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp)).padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(Modifier.align(Alignment.CenterHorizontally).width(36.dp).height(4.dp).clip(RoundedCornerShape(2.dp)).background(c.border))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("总览 v2", c.text, 18, weight = FontWeight.SemiBold)
            SoftTag("进行中", pal.chart2)
            SoftTag("oa_1", pal.chart2)
        }
        Text("上级: #121 安卓 UI 专项 · 子任务 2 / 4", c.textSecondary, 13)
        ProgressLine(0.5f)
        Row(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            HxButton("加子待办", {}, Modifier.weight(1f), size = HxButtonSize.Sm, icon = "plus")
            HxButton("完成", {}, Modifier.weight(1f), variant = HxButtonVariant.Secondary, size = HxButtonSize.Sm, icon = "check")
            HxButton("折叠", {}, Modifier.weight(1f), variant = HxButtonVariant.Secondary, size = HxButtonSize.Sm)
        }
    }
}
