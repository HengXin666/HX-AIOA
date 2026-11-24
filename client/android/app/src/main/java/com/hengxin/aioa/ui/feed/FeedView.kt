package com.hengxin.aioa.ui.feed

import android.text.format.DateFormat
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.pressable
import com.hengxin.aioa.proto.ServerFrame
import java.util.Calendar

private const val PAD = 16
private val PILL = RoundedCornerShape(50)
private val TABS = listOf("今天", "全部", "收藏", "用过")
private const val TAB_TODAY = 0
private const val TAB_STAR = 2
private const val TAB_USED = 3
private const val CHIP_ALPHA = 0.12f

/** 信息流: 群里所有推送按条目平铺; 今天 / 全部 / 收藏 / 用过, 类别筛选, 右滑用过了, 左滑标失效。 */
@Composable
fun FeedView(messages: List<ServerFrame.Msg>, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val c = Aioa.colors
    val marks = remember { FeedMarks.of(context) }
    var tab by rememberSaveable { mutableStateOf(TAB_TODAY) }
    var kind by rememberSaveable { mutableStateOf<String?>(null) }
    var live by rememberSaveable { mutableStateOf(false) }
    val all = remember(messages.size, messages.lastOrNull()?.seq) { feedItems(messages) }
    val today = remember(all) { startOfDay() }
    @Suppress("UNUSED_VARIABLE") val v = marks.version
    val inTab = all.filter {
        when (tab) {
            TAB_TODAY -> it.ts >= today
            TAB_STAR -> marks.has(FeedMarks.STAR, it.key)
            TAB_USED -> marks.has(FeedMarks.USED, it.key)
            else -> true
        }
    }
    val shown = inTab.filter { (kind == null || it.kind == kind) && (!live || marks.status(it).let { s -> s == ST_OK || s == ST_GO }) }
    Column(modifier.background(c.background)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = PAD.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
            TABS.forEachIndexed { i, t ->
                Column(Modifier.pressable { tab = i }, horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(t, color = if (tab == i) c.text else c.textSecondary, fontSize = 16.sp, fontWeight = if (tab == i) FontWeight.Bold else FontWeight.Normal)
                    Box(Modifier.padding(top = 4.dp).height(3.dp).fillMaxWidth(0.6f).clip(PILL).background(if (tab == i) c.accent else Color.Transparent))
                }
            }
        }
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = PAD.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Chip("全部", inTab.size, kind == null) { kind = null }
            listOf(KIND_DEAL, KIND_OSS, KIND_NEWS, KIND_OTHER).forEach { k ->
                val n = inTab.count { it.kind == k }
                if (n > 0) Chip(KIND_LABEL.getValue(k), n, kind == k) { kind = if (kind == k) null else k }
            }
            Chip("只看有效", null, live, icon = "circle-check") { live = !live }
        }
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = PAD.dp, end = PAD.dp, top = 8.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (tab == TAB_TODAY) item(key = "today") { TodayCard(inTab, marks) }
            if (shown.isEmpty()) item(key = "empty") { Empty(if (tab == TAB_STAR) "还没有收藏, 点条目右上角的星标收藏" else "这里还没有内容") }
            items(shown, key = { it.key }) { SwipeItem(it, marks) }
        }
    }
}

private fun startOfDay(): Long = Calendar.getInstance().apply { set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0) }.timeInMillis

@Composable
private fun Chip(label: String, count: Int?, on: Boolean, icon: String? = null, onClick: () -> Unit) {
    val c = Aioa.colors
    val fg = if (on) c.accent else c.textSecondary
    Row(Modifier.clip(PILL).background(if (on) c.accent.copy(alpha = CHIP_ALPHA) else c.surfaceAlt).pressable(onClick).padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        icon?.let { Icon(it, fg, 14.dp) }
        Text(label, color = fg, fontSize = 13.sp, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal)
        count?.let { Text("$it", color = fg, fontSize = 12.sp) }
    }
}

/** 今天概览: 各类条数和还有效的福利数。 */
@Composable
private fun TodayCard(items: List<FeedItem>, marks: FeedMarks) {
    val context = LocalContext.current
    val c = Aioa.colors
    val now = System.currentTimeMillis()
    val ok = items.count { it.kind == KIND_DEAL && marks.status(it).let { s -> s == ST_OK || s == ST_GO } }
    val shape = RoundedCornerShape(16.dp)
    Column(Modifier.fillMaxWidth().clip(shape).background(c.surface).padding(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("今天 · ${DateFormat.format("M-d", now)}", color = c.text, fontSize = 15.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.weight(1f))
            Text("截至 ${DateFormat.getTimeFormat(context).format(now)}", color = c.textSecondary, fontSize = 12.sp)
        }
        Row(Modifier.padding(top = 12.dp).fillMaxWidth()) {
            Stat("福利", items.count { it.kind == KIND_DEAL }, c.text)
            Stat("开源", items.count { it.kind == KIND_OSS }, c.text)
            Stat("资讯", items.count { it.kind == KIND_NEWS }, c.text)
            Stat("有效福利", ok, c.success)
        }
    }
}

@Composable
private fun androidx.compose.foundation.layout.RowScope.Stat(label: String, n: Int, color: Color) {
    val c = Aioa.colors
    Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
        Text("$n", color = color, fontSize = 22.sp, fontWeight = FontWeight.Bold)
        Text(label, color = c.textSecondary, fontSize = 12.sp)
    }
}

@Composable
private fun Empty(text: String) {
    val c = Aioa.colors
    Column(Modifier.fillMaxWidth().padding(top = 60.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Icon("inbox", c.textSecondary, 36.dp)
        Text(text, Modifier.padding(top = 8.dp), color = c.textSecondary, fontSize = 13.sp)
    }
}

/** 右滑: 用过了 (再滑取消); 左滑: 标成失效 (再滑取消)。都不移走, 只改标记。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SwipeItem(it: FeedItem, marks: FeedMarks) {
    val c = Aioa.colors
    val shape = RoundedCornerShape(14.dp)
    val box = rememberSwipeToDismissBoxState(confirmValueChange = { v ->
        when (v) {
            SwipeToDismissBoxValue.StartToEnd -> marks.toggle(FeedMarks.USED, it.key)
            SwipeToDismissBoxValue.EndToStart -> marks.toggle(FeedMarks.DEAD, it.key)
            else -> Unit
        }
        false
    })
    SwipeToDismissBox(box, modifier = Modifier.clip(shape), backgroundContent = {
        val dir = box.dismissDirection
        val bg by animateColorAsState(when (dir) { SwipeToDismissBoxValue.StartToEnd -> c.success; SwipeToDismissBoxValue.EndToStart -> c.textSecondary; else -> Color.Transparent }, label = "swipe")
        Row(Modifier.fillMaxSize().background(bg).padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
            if (dir == SwipeToDismissBoxValue.StartToEnd) { Icon("square-check", Color.White, 20.dp); Text(" 用过了", color = Color.White, fontSize = 13.sp) }
            Spacer(Modifier.weight(1f))
            if (dir == SwipeToDismissBoxValue.EndToStart) { Icon("ban", Color.White, 20.dp); Text(" 失效", color = Color.White, fontSize = 13.sp) }
        }
    }) { FeedItemCard(it, marks) }
}
