package com.hengxin.aioa.ui.todo

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.TodoRow
import java.util.Calendar
import java.util.TimeZone
import androidx.compose.material3.Text as M3Text

private val CHIP = RoundedCornerShape(50)
private const val CHIP_ALPHA = 0.12f
private val REMINDS = listOf(null to "不提醒", 0 to "到点", 5 to "5 分钟", 15 to "15 分钟", 30 to "30 分钟", 60 to "1 小时", 1440 to "1 天")
private const val DEFAULT_REMIND = 15
private const val MAX_EVERY = 365
private const val EVENING = 18
private const val MORNING = 9

/**
 * 新建或编辑待办: 标题, 说明, 分区, 优先级, 星标, 截止 (快捷 + 日期时间), 提醒, 闹钟响铃, 周期。
 * 开提醒时顺带检查通知 / 精确闹钟 / 全屏提醒权限, 缺哪个给一个去开的入口。save 拿到 (改后的待办, 是否新建)。
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun TodoEdit(start: TodoRow, areas: List<String>, fresh: Boolean, close: () -> Unit, save: (Pair<TodoRow, Boolean>) -> Unit) {
    val c = Aioa.colors
    var r by remember(start.id) { mutableStateOf(start) }
    var customArea by remember { mutableStateOf<String?>(null) }
    var picking by remember { mutableStateOf(false) }
    ModalBottomSheet(close, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = c.surface) {
        Column(Modifier.navigationBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp).padding(bottom = 18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                M3Text(if (fresh) "新建待办" else "编辑待办", Modifier.weight(1f), color = c.text, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                Chip(if (r.star) "已标重点" else "标为重点", r.star, "star") { r = r.copy(star = !r.star) }
            }
            OutlinedTextField(r.title, { r = r.copy(title = it.take(TITLE_MAX)) }, Modifier.fillMaxWidth(), label = { M3Text("要做什么") }, singleLine = true)
            OutlinedTextField(r.note.orEmpty(), { r = r.copy(note = it.take(NOTE_MAX).ifEmpty { null }) }, Modifier.fillMaxWidth(), label = { M3Text("说明 (可选)") }, minLines = 2, maxLines = 5)
            Label("分区")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                (areas + listOfNotNull(r.area)).distinct().forEach { a -> Chip(a, r.area == a) { r = r.copy(area = if (r.area == a) null else a) } }
                Chip("自定义", customArea != null, "plus") { customArea = customArea?.let { null } ?: "" }
            }
            customArea?.let { text ->
                OutlinedTextField(text, { customArea = it.take(AREA_MAX); r = r.copy(area = it.trim().take(AREA_MAX).ifEmpty { null }) }, Modifier.fillMaxWidth(), label = { M3Text("分区名, 如 家里 / 健身") }, singleLine = true)
            }
            Label("优先级")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(1 to "P1 紧急", 2 to "P2 普通", 3 to "P3 以后").forEach { (p, l) -> Chip(l, r.prio == p) { r = r.copy(prio = p) } }
            }
            Label("截止")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Chip("今晚 18:00", false) { r = r.copy(due = at(0, EVENING)) }
                Chip("明早 9:00", false) { r = r.copy(due = at(1, MORNING)) }
                Chip("下周一 9:00", false) { r = r.copy(due = nextMonday()) }
                Chip(r.due?.let { dueText(it) } ?: "选日期时间", r.due != null, "calendar-days") { picking = true }
                if (r.due != null) Chip("清除", false, "x") { r = r.copy(due = null, remind = null, alarm = false, everyUnit = null) }
            }
            r.due?.let { due -> M3Text(countdown(due).first, color = c.textSecondary, fontSize = 12.sp) }
            if (r.due != null) {
                Label("提醒")
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    REMINDS.forEach { (m, l) -> Chip(l, r.remind == m) { r = r.copy(remind = m, alarm = r.alarm && m != null) } }
                }
                if (r.remind != null) {
                    Toggle("闹钟响铃", "到点像闹钟一样持续响, 直到点停止; 关掉则是普通通知", r.alarm) { r = r.copy(alarm = it) }
                    Permissions(r.alarm)
                }
                Label("重复")
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Chip("不重复", r.everyUnit == null) { r = r.copy(everyUnit = null) }
                    EVERY_UNITS.forEach { (u, l) -> Chip("按${l.removePrefix("个")}", r.everyUnit == u) { r = r.copy(everyUnit = u) } }
                }
                r.everyUnit?.let {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        M3Text(everyText(it, r.everyN).orEmpty(), Modifier.weight(1f), color = c.text, fontSize = 14.sp)
                        Chip("-", false) { r = r.copy(everyN = (r.everyN - 1).coerceAtLeast(1)) }
                        Chip("+", false, modifier = Modifier.padding(start = 8.dp)) { r = r.copy(everyN = (r.everyN + 1).coerceAtMost(MAX_EVERY)) }
                    }
                    M3Text("勾完成后自动排到下一期 (如每月交电费), 不用每次新建。", color = c.textSecondary, fontSize = 12.sp)
                }
            }
            val ok = r.title.isNotBlank()
            Row(Modifier.fillMaxWidth().padding(top = 6.dp).clip(RoundedCornerShape(12.dp)).background(if (ok) c.accent else c.surfaceAlt).clickable(enabled = ok) { save(r.copy(title = r.title.trim()) to fresh); close() }.padding(vertical = 12.dp), horizontalArrangement = Arrangement.Center) {
                M3Text(if (fresh) "新建" else "保存", color = if (ok) c.onAccent else c.textSecondary, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
    if (picking) DueDialog(r.due, { picking = false }) { r = r.copy(due = it, remind = r.remind ?: DEFAULT_REMIND.takeIf { r.due == null }) }
}

private const val TITLE_MAX = 200
private const val NOTE_MAX = 2000
private const val AREA_MAX = 20

/** 先选日期再选时间; 日期选择器给的是 UTC 零点, 换成本地日期。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DueDialog(current: Long?, close: () -> Unit, pick: (Long) -> Unit) {
    val cal = Calendar.getInstance().apply { timeInMillis = current ?: at(0, EVENING) }
    val utcDay = cal.timeInMillis + TimeZone.getDefault().getOffset(cal.timeInMillis)
    val date = rememberDatePickerState(initialSelectedDateMillis = utcDay)
    var day by remember { mutableStateOf<Long?>(null) }
    val d = day
    if (d == null) {
        DatePickerDialog(close, confirmButton = { TextButton({ day = date.selectedDateMillis ?: utcDay }) { M3Text("下一步") } }, dismissButton = { TextButton(close) { M3Text("取消") } }) {
            DatePicker(date)
        }
        return
    }
    val time = rememberTimePickerState(cal.get(Calendar.HOUR_OF_DAY), cal.get(Calendar.MINUTE), is24Hour = true)
    AlertDialog(
        onDismissRequest = close,
        confirmButton = {
            TextButton({
                val utc = Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply { timeInMillis = d }
                val local = Calendar.getInstance().apply {
                    clear()
                    set(utc.get(Calendar.YEAR), utc.get(Calendar.MONTH), utc.get(Calendar.DAY_OF_MONTH), time.hour, time.minute)
                }
                pick(local.timeInMillis)
                close()
            }) { M3Text("确定") }
        },
        dismissButton = { TextButton({ day = null }) { M3Text("上一步") } },
        text = { TimePicker(time) },
    )
}

/** 提醒要用到的权限: 通知 (13 起), 精确闹钟 (12 上要手动开), 闹钟全屏 (14 起要手动开)。缺的给入口, 齐了不显示。 */
@Composable
private fun Permissions(alarm: Boolean) {
    val c = Aioa.colors
    val context = LocalContext.current
    var bump by remember { mutableStateOf(0) }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { bump++ }
    val missing = remember(alarm, bump) { missingPermissions(context, alarm) }
    missing.forEach { (text, open) ->
        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(c.warning.copy(alpha = CHIP_ALPHA)).clickable {
            if (open == null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) ask.launch(Manifest.permission.POST_NOTIFICATIONS)
            else open?.let { runCatching { context.startActivity(it) } }
            bump++
        }.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon("bell", c.warning, 14.dp)
            M3Text(text, Modifier.padding(start = 6.dp).weight(1f), color = c.text, fontSize = 12.sp)
            M3Text("去开启", color = c.accent, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

// (说明, 去设置的 Intent); Intent 为 null 表示用运行时权限弹窗
private fun missingPermissions(context: Context, alarm: Boolean): List<Pair<String, Intent?>> {
    val out = ArrayList<Pair<String, Intent?>>()
    val pkg = Uri.parse("package:${context.packageName}")
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
        out += "没有通知权限, 到点提醒弹不出来" to null
    }
    val am = context.getSystemService(AlarmManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && am?.canScheduleExactAlarms() == false) {
        out += "没有精确闹钟权限, 提醒可能晚几分钟" to Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, pkg)
    }
    val nm = context.getSystemService(NotificationManager::class.java)
    if (alarm && Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE && nm?.canUseFullScreenIntent() == false) {
        out += "锁屏时闹钟不能全屏弹出, 只会响铃和横幅" to Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, pkg)
    }
    return out
}

/** 今天起第 days 天的 hour 点; 今天已过就顺延一天。 */
private fun at(days: Int, hour: Int): Long {
    val cal = Calendar.getInstance().apply {
        add(Calendar.DAY_OF_YEAR, days)
        set(Calendar.HOUR_OF_DAY, hour)
        set(Calendar.MINUTE, 0)
        set(Calendar.SECOND, 0)
        set(Calendar.MILLISECOND, 0)
    }
    if (cal.timeInMillis <= System.currentTimeMillis()) cal.add(Calendar.DAY_OF_YEAR, 1)
    return cal.timeInMillis
}

private fun nextMonday(): Long {
    val cal = Calendar.getInstance()
    val ahead = (Calendar.MONDAY - cal.get(Calendar.DAY_OF_WEEK) + 7) % 7
    return at(if (ahead == 0) 7 else ahead, MORNING)
}

@Composable
private fun Label(text: String) = M3Text(text, Modifier.padding(top = 6.dp), color = Aioa.colors.textSecondary, fontSize = 12.sp)

@Composable
private fun Chip(label: String, on: Boolean, icon: String? = null, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val c = Aioa.colors
    Row(modifier.clip(CHIP).background(if (on) c.accent.copy(alpha = CHIP_ALPHA) else c.surfaceAlt).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
        icon?.let { Icon(it, if (on) c.accent else c.textSecondary, 13.dp, Modifier.padding(end = 4.dp)) }
        M3Text(label, color = if (on) c.accent else c.text, fontSize = 13.sp, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal)
    }
}

@Composable
private fun Toggle(title: String, hint: String, on: Boolean, set: (Boolean) -> Unit) {
    val c = Aioa.colors
    Row(Modifier.fillMaxWidth().clickable { set(!on) }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            M3Text(title, color = c.text, fontSize = 15.sp)
            M3Text(hint, color = c.textSecondary, fontSize = 12.sp)
        }
        Switch(on, set)
    }
}
