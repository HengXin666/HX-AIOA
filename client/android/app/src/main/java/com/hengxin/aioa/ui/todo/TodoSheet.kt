package com.hengxin.aioa.ui.todo

import android.content.Context
import android.content.Intent
import android.provider.AlarmClock
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import java.util.Calendar
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.browser.Browser
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.TodoRow

private const val GITHUB = "https://github.com/"
private val FIELD = RoundedCornerShape(12.dp)
private val SEG = RoundedCornerShape(10.dp)
private val PRIOS = listOf(1 to "P1 紧急", 2 to "P2 普通", 3 to "P3 以后")

/**
 * 待办详情: 四态切换, 优先级, 分区, 截止倒计时, 提醒, 周期, 创建时间与来源消息, 关联的 issue (内置浏览器打开);
 * 底部 编辑 / 加系统闹钟 / 删除。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TodoSheet(r: TodoRow, all: List<TodoRow>, close: () -> Unit, setState: (String) -> Unit, setPrio: (Int) -> Unit, edit: () -> Unit, remove: () -> Unit, jump: (Long) -> Unit) {
    val c = Aioa.colors
    val context = LocalContext.current
    var confirm by remember { mutableStateOf(false) }
    ModalBottomSheet(close, containerColor = c.surface) {
        Column(Modifier.navigationBarsPadding().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp).padding(bottom = 18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (r.star) Icon("star", c.warning, 16.dp, Modifier.padding(end = 6.dp))
                Text(r.title, Modifier.weight(1f), color = c.text, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
            }
            Segments(STATES.map { it to stateLabel(it) }, if (r.state == TodoRow.STATE_DROPPED) TodoRow.STATE_DONE else r.state, setState)
            Segments(PRIOS, r.prio, setPrio)
            Field("分区", r.areaKey)
            r.due?.let { due ->
                val (left, hot) = countdown(due)
                Field("截止", "${dueText(due)} · ${if (r.finished) "已完成" else left}", valueColor = if (hot && !r.finished) c.danger else null)
            }
            r.remind?.takeIf { r.due != null }?.let { Field("提醒", remindText(it) + if (r.alarm) " · 闹钟响铃" else " · 通知") }
            everyText(r.everyUnit, r.everyN)?.let { Field("周期", it + if (r.runs > 0) " · 已完成 ${r.runs} 期" else "") }
            val created = if (r.created > 0) "${dayOf(r.created)} ${clock(r.created)}" else "未知"
            Field("创建", created + if (r.src != null) " · 来源消息" else "", if (r.src != null) "chevron-right" else null, onClick = r.src?.let { s -> { jump(s) } })
            r.doneAt?.takeIf { r.finished }?.let { Field("完成", "${dayOf(it)} ${clock(it)}") }
            if (r.repo != null && r.issue != null) {
                val st = when (r.ghOpen) {
                    null -> "未同步"
                    false -> "已关闭"
                    else -> if (r.ghComments > 0) "打开 · ${r.ghComments} 评论" else "打开"
                }
                Field("issue", "${r.repo}#${r.issue} · $st", "external-link") { Browser.open(context, "$GITHUB${r.repo}/issues/${r.issue}") }
            } else r.repo?.let { Field("仓库", it) }
            val parent = r.parent?.let { p -> all.find { it.id == p } } ?: r.ghParent?.let { n -> all.find { it.repo == r.repo && it.issue == n } }
            parent?.let { Field("父任务", it.title) }
            r.note?.let { Text(it, color = c.textSecondary, fontSize = 13.sp, lineHeight = 19.sp) }
            if (r.issue != null) Text("issue 关闭后自动完成, 有评论自动变进行中; 这里手动改不会动 GitHub。", color = c.textSecondary, fontSize = 12.sp)
            if (r.everyUnit != null) Text("周期待办: 勾完成后自动排到下一期, 截止时间往后推。", color = c.textSecondary, fontSize = 12.sp)
            Row(Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Action("pencil", "编辑", c.accent, Modifier.weight(1f), edit)
                // 系统闹钟只能按 "时:分" 设下一次, 所以只给 24 小时内的提醒用
                r.fireAt?.takeIf { it - System.currentTimeMillis() in 0 until DAY_MS }?.let { at ->
                    Action("alarm-clock", "系统闹钟", c.accent, Modifier.weight(1f)) { setSystemAlarm(context, at, r.title) }
                }
                Action("trash-2", if (confirm) "确认删除" else "删除", c.danger, Modifier.weight(1f)) { if (confirm) remove() else confirm = true }
            }
        }
    }
}

private const val DAY_MS = 86_400_000L

/** 交给手机自带的时钟 App 定一个闹钟 (不弹它的界面); 没有时钟 App 时提示。 */
private fun setSystemAlarm(context: Context, at: Long, title: String) {
    val cal = Calendar.getInstance().apply { timeInMillis = at }
    val intent = Intent(AlarmClock.ACTION_SET_ALARM)
        .putExtra(AlarmClock.EXTRA_HOUR, cal.get(Calendar.HOUR_OF_DAY))
        .putExtra(AlarmClock.EXTRA_MINUTES, cal.get(Calendar.MINUTE))
        .putExtra(AlarmClock.EXTRA_MESSAGE, title.take(ALARM_LABEL_MAX))
        .putExtra(AlarmClock.EXTRA_SKIP_UI, true)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    val ok = runCatching { context.startActivity(intent) }.isSuccess
    Toast.makeText(context, if (ok) "已在系统时钟设 ${clock(at)} 的闹钟" else "没找到系统时钟 App", Toast.LENGTH_SHORT).show()
}

private const val ALARM_LABEL_MAX = 40

@Composable
private fun Action(icon: String, label: String, tint: Color, modifier: Modifier, onClick: () -> Unit) {
    val c = Aioa.colors
    Row(modifier.clip(FIELD).background(c.surfaceAlt).clickable(onClick = onClick).padding(vertical = 11.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, tint, 16.dp)
        Text(label, Modifier.padding(start = 6.dp), color = tint, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun <T> Segments(options: List<Pair<T, String>>, current: T, pick: (T) -> Unit) {
    val c = Aioa.colors
    Row(Modifier.fillMaxWidth().clip(SEG).background(c.surfaceAlt).padding(3.dp)) {
        options.forEach { (v, label) ->
            val on = v == current
            val tint = (v as? String)?.let { stateColor(it) } ?: c.accent
            Text(
                label,
                Modifier.weight(1f).clip(RoundedCornerShape(8.dp)).background(if (on) c.surface else Color.Transparent).clickable { if (!on) pick(v) }.padding(vertical = 8.dp),
                color = if (on) tint else c.textSecondary,
                fontSize = 13.sp,
                fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
        }
    }
}

@Composable
private fun Field(key: String, value: String, icon: String? = null, valueColor: Color? = null, onClick: (() -> Unit)? = null) {
    val c = Aioa.colors
    Row(Modifier.fillMaxWidth().clip(FIELD).background(c.surfaceAlt).clickable(enabled = onClick != null) { onClick?.invoke() }.padding(horizontal = 12.dp, vertical = 11.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(key, Modifier.width(52.dp), color = c.textSecondary, fontSize = 12.sp)
        Text(value, Modifier.weight(1f), color = valueColor ?: c.text, fontSize = 14.sp, maxLines = 2)
        icon?.let { Icon(it, c.textSecondary, 16.dp) }
    }
}

/** 筛选: 仓库多选, 显示已完成, 只看有 issue, 优先级。改了立即生效并记住。 */
@OptIn(ExperimentalMaterial3Api::class, androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
fun FilterSheet(f: TodoFilter, repos: List<String>, areas: List<String>, set: (TodoFilter) -> Unit, close: () -> Unit) {
    val c = Aioa.colors
    ModalBottomSheet(close, containerColor = c.surface) {
        Column(Modifier.navigationBarsPadding().padding(horizontal = 18.dp).padding(bottom = 18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("筛选", color = c.text, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
            Label("分区 (不选为全部)")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                (areas + TodoRow.AREA_NONE).forEach { a ->
                    val on = a in f.areas
                    SheetChip(a, on, c.accent) { set(f.copy(areas = if (on) f.areas - a else f.areas + a)) }
                }
            }
            Label("仓库 (不选为全部)")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                repos.forEach { repo ->
                    val on = repo in f.repos
                    SheetChip(if (repo == NO_REPO) repo else repoName(repo), on, repoColor(repo)) { set(f.copy(repos = if (on) f.repos - repo else f.repos + repo)) }
                }
            }
            Label("显示")
            Toggle("显示已完成", "打开后划掉显示", f.showDone) { set(f.copy(showDone = it)) }
            Toggle("只看重点", "星标的待办", f.onlyStar) { set(f.copy(onlyStar = it)) }
            Toggle("只看关联了 issue 的", null, f.onlyIssue) { set(f.copy(onlyIssue = it)) }
            Label("优先级")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PRIOS.forEach { (p, label) ->
                    val on = p in f.prios
                    SheetChip(label, on, c.accent) { if (!on || f.prios.size > 1) set(f.copy(prios = if (on) f.prios - p else f.prios + p)) }
                }
            }
        }
    }
}

@Composable
private fun Label(text: String) = Text(text, Modifier.padding(top = 8.dp), color = Aioa.colors.textSecondary, fontSize = 12.sp)

@Composable
private fun SheetChip(label: String, on: Boolean, dot: Color, onClick: () -> Unit) {
    val c = Aioa.colors
    Row(Modifier.clip(RoundedCornerShape(50)).background(if (on) c.accent.copy(alpha = 0.12f) else c.surfaceAlt).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        androidx.compose.foundation.layout.Box(Modifier.padding(end = 6.dp).clip(RoundedCornerShape(2.dp)).background(dot).padding(4.dp))
        Text(label, color = if (on) c.accent else c.text, fontSize = 13.sp, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal)
        if (on) Icon("check", c.accent, 14.dp, Modifier.padding(start = 4.dp))
    }
}

@Composable
private fun Toggle(title: String, hint: String?, on: Boolean, set: (Boolean) -> Unit) {
    val c = Aioa.colors
    Row(Modifier.fillMaxWidth().clickable { set(!on) }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, color = c.text, fontSize = 15.sp)
            hint?.let { Text(it, color = c.textSecondary, fontSize = 12.sp) }
        }
        Switch(on, set)
    }
}
