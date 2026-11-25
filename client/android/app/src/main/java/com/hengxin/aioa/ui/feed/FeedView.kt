package com.hengxin.aioa.ui.feed

import android.text.format.DateFormat
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
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
import com.hengxin.aioa.ui.chat.RevealAction
import com.hengxin.aioa.ui.chat.SwipeQuick
import com.hengxin.aioa.ui.chat.SwipeReveal
import java.util.Calendar

private const val PAD = 16
private val PILL = RoundedCornerShape(50)
private val TABS = listOf("今天", "全部", "收藏", "用过")
private const val TAB_TODAY = 0
private const val TAB_STAR = 2
private const val TAB_USED = 3
private const val CHIP_ALPHA = 0.12f
// 今天卡片一行最多几格, 多了挤
private const val MAX_STATS = 4

/** 信息流: 群里所有推送按条目平铺; 今天 / 全部 / 收藏 / 用过, 类别筛选, 右滑用过了, 左滑标失效。 */
@Composable
fun FeedView(messages: List<ServerFrame.Msg>, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val c = Aioa.colors
    val marks = remember { FeedMarks.of(context) }
    var tab by rememberSaveable { mutableStateOf(TAB_TODAY) }
    var kind by rememberSaveable { mutableStateOf<String?>(null) }
    var live by rememberSaveable { mutableStateOf(false) }
    var swiped by remember { mutableStateOf<String?>(null) }
    val tags = LocalFeedTags.current
    val all = remember(messages.size, messages.lastOrNull()?.seq, tags) { feedItems(messages, tags) }
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
    // 标签按群里的顺序, 旧消息里出现但表里没有的排在后面
    val kinds = remember(all, tags) { tags.map { it.id } + all.map { it.kind }.distinct().filter { k -> tags.none { it.id == k } } }
    val shown = inTab.filter { (kind == null || it.kind == kind) && (!live || marks.status(it).let { s -> s == ST_OK || s == ST_GO }) }
    Column(modifier.background(c.background)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = PAD.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(22.dp)) {
            TABS.forEachIndexed { i, t ->
                // 指示条固定宽度; 用 fillMaxWidth 会让第一个标签吃掉整行, 后面的被挤成竖排
                Column(Modifier.pressable { tab = i }, horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(t, color = if (tab == i) c.text else c.textSecondary, fontSize = 15.sp, fontWeight = if (tab == i) FontWeight.SemiBold else FontWeight.Normal, maxLines = 1, softWrap = false)
                    Box(Modifier.padding(top = 4.dp).height(3.dp).width(16.dp).clip(PILL).background(if (tab == i) c.accent else Color.Transparent))
                }
            }
        }
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = PAD.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Chip("全部", inTab.size, kind == null) { kind = null }
            kinds.forEach { k ->
                val n = inTab.count { it.kind == k }
                if (n > 0) Chip(tags.labelOf(k), n, kind == k) { kind = if (kind == k) null else k }
            }
            if (all.any { it.status != null }) Chip("只看有效", null, live, icon = "circle-check") { live = !live }
        }
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = PAD.dp, end = PAD.dp, top = 8.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (tab == TAB_TODAY && inTab.isNotEmpty()) item(key = "today") { TodayCard(inTab, kinds, marks) }
            if (shown.isEmpty()) item(key = "empty") { Empty(if (tab == TAB_STAR) "还没有收藏, 点条目右上角的星标收藏" else "这里还没有内容") }
            items(shown, key = { it.key }) { SwipeItem(it, marks, swiped) { k -> swiped = k } }
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

/** 今天概览: 只列实际出现的类别; 有状态的福利才显示 "有效"; 全是普通消息时提示还没用信息流格式。 */
@Composable
private fun TodayCard(items: List<FeedItem>, order: List<String>, marks: FeedMarks) {
    val context = LocalContext.current
    val c = Aioa.colors
    val now = System.currentTimeMillis()
    val tags = LocalFeedTags.current
    val kinds = order.map { k -> k to items.count { it.kind == k } }.filter { it.second > 0 }.take(MAX_STATS)
    // "有效" 统计所有带状态的条目, 不再只认某一个标签
    val rated = items.filter { it.status != null }
    val ok = rated.count { marks.status(it).let { s -> s == ST_OK || s == ST_GO } }
    val shape = RoundedCornerShape(16.dp)
    Column(Modifier.fillMaxWidth().clip(shape).background(c.surface).padding(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("今天 · ${DateFormat.format("M-d", now)}", color = c.text, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.weight(1f))
            Text("截至 ${DateFormat.getTimeFormat(context).format(now)}", color = c.textSecondary, fontSize = 12.sp)
        }
        if (kinds.all { it.first == TAG_OTHER }) {
            Text("今天 ${items.size} 条都是普通消息, 推送方切到信息流格式后会按类别统计", Modifier.padding(top = 8.dp), color = c.textSecondary, fontSize = 12.sp, lineHeight = 17.sp)
            return@Column
        }
        Row(Modifier.padding(top = 12.dp).fillMaxWidth()) {
            kinds.forEach { (k, n) -> Stat(tags.labelOf(k), n, kindColor(k)) }
            if (rated.isNotEmpty()) Stat("仍有效", ok, c.success)
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

/** 右滑: 用过了 (再滑取消); 左滑露出 "失效" 按钮, 点了才标记。都不移走, 只改标记。 */
@Composable
private fun SwipeItem(it: FeedItem, marks: FeedMarks, swiped: String?, onSwiped: (String?) -> Unit) {
    val c = Aioa.colors
    val open = swiped == it.key
    val dead = marks.has(FeedMarks.DEAD, it.key)
    val mark = RevealAction(if (dead) "circle-check" else "ban", if (dead) "恢复" else "失效", c.textSecondary) { marks.toggle(FeedMarks.DEAD, it.key) }
    val used = SwipeQuick("square-check", c.success) { marks.toggle(FeedMarks.USED, it.key) }
    Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp))) {
        SwipeReveal(open, { o -> onSwiped(if (o) it.key else if (open) null else swiped) }, listOf(mark), used) { FeedItemCard(it, marks, Modifier.fillMaxWidth()) }
    }
}
