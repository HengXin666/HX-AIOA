package com.hengxin.aioa.ui.agents

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.data.MessageDb
import com.hengxin.aioa.ui.ChatModel
import com.hengxin.aioa.ui.chat.ChatAgent
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private val TAG_SHAPE = RoundedCornerShape(6.dp)
private val CLOCK = SimpleDateFormat("MM-dd HH:mm", Locale.CHINA)
private const val TXT_RELINK = "需重新接入"
private const val TXT_SWITCH_HINT = "触发语会变, 需要把新接入语发给 Agent 一次。"
private const val TXT_NEXT = "下次触发"
private const val TXT_UNKNOWN = "无法推算"
private val CLOCK_TIME = SimpleDateFormat("HH:mm", Locale.CHINA)
private val DAY_NAMES = listOf("今天", "明天")

/** 用过 skill 版接口的 Agent 才有这些字段; 旧指令 Agent 不显示 skill 区。 */
fun isSkillAgent(a: ChatAgent) = a.skills != null || a.setup != null || a.handled != null || a.trigger != null || a.lastRun != null

@Composable
fun AgentTag(text: String, alert: Boolean = false) {
    val c = MaterialTheme.colorScheme
    Text(text, Modifier.background(c.surface, TAG_SHAPE).padding(horizontal = 6.dp, vertical = 1.dp), fontSize = 11.sp, color = if (alert) c.error else c.outline)
}

@Composable
fun rememberSkill(a: ChatAgent, now: Long): SkillStatus {
    val context = LocalContext.current
    val plugin = PluginSkills.get(context, a.plugin)
    return remember(a, plugin) { skillStatus(context, a, plugin, now) }
}

/** 本地已有消息里还没被这个 Agent 处理的人发消息条数; 不是 skill 版 Agent 为 null。 */
@Composable
fun rememberPending(group: String, a: ChatAgent, now: Long): Int? {
    val context = LocalContext.current
    val n by produceState<Int?>(null, group, a.handled, a.handledSet, now) {
        val h = a.handled ?: return@produceState
        value = withContext(Dispatchers.IO) { MessageDb.get(context).humanAfter(group, h, a.handledSet) }
    }
    return n
}

/** 卡片上的小标签: skill 状态, 待处理, 定时迟到。 */
@Composable
fun SkillTags(group: String, a: ChatAgent, now: Long) {
    if (!isSkillAgent(a)) return
    val s = rememberSkill(a, now)
    val pending = rememberPending(group, a, now)
    when (s.gap) {
        SkillGap.SAME -> AgentTag("skill 最新")
        SkillGap.MINOR -> AgentTag("小更新待生效")
        SkillGap.MAJOR -> AgentTag(TXT_RELINK, true)
    }
    pending?.takeIf { it > 0 }?.let { AgentTag("待处理 $it") }
    val run = runInfo(a, now) ?: return
    AgentTag(run.next?.let { "$TXT_NEXT ${CLOCK.format(Date(it))} (${until(it, now)})" } ?: "$TXT_NEXT: $TXT_UNKNOWN", run.late)
    if (run.late) AgentTag("定时未运行", true)
}

// 时间点按本机日界标 "今天 / 明天", 更远的写日期
private fun dayLabel(ts: Long, now: Long): String {
    val zone = java.time.ZoneId.systemDefault()
    val day = { t: Long -> java.time.Instant.ofEpochMilli(t).atZone(zone).toLocalDate().toEpochDay() }
    return DAY_NAMES.getOrNull((day(ts) - day(now)).toInt())?.let { "$it ${CLOCK_TIME.format(Date(ts))}" } ?: CLOCK.format(Date(ts))
}

@Composable
private fun TriggerLines(a: ChatAgent, run: TriggerView?, now: Long) {
    val t = a.trigger
    if (t == null || run == null) {
        Line("触发方式", "还没上报")
        return
    }
    val tz = t.tz?.takeIf { run.zone != java.time.ZoneId.systemDefault() }?.let { " · 按 $it 推算" } ?: ""
    Line("触发方式", t.expr + tz)
    if (!run.parsed) {
        Line(TXT_NEXT, "$TXT_UNKNOWN (${t.expr})")
        return
    }
    val lateText = if (run.late) run.expected?.let { " · 预计 ${CLOCK.format(Date(it))} 触发, 还没运行" } ?: "" else ""
    Line(TXT_NEXT, run.next?.let { "${CLOCK.format(Date(it))} (${until(it, now)})$lateText" } ?: TXT_UNKNOWN, run.late)
    if (run.upcoming.isNotEmpty()) Line("接下来", run.upcoming.joinToString("\n") { "${dayLabel(it, now)} (${until(it, now)})" })
}

/** 详情里的运行与 skill 区: 触发方式, 上次 / 下次运行, 待处理, 版本状态, 自动大更新开关, 复制新接入语。 */
@Composable
fun SkillSection(model: ChatModel, group: String, a: ChatAgent, now: Long) {
    val c = MaterialTheme.colorScheme
    if (!isSkillAgent(a)) {
        Text("还没装 skill, 仍用旧的专属指令; 重新接入后改用 skill。", fontSize = 12.sp, color = c.outline)
        return
    }
    val dir = model.groups.directory
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    var confirm by remember { mutableStateOf<Boolean?>(null) }
    var copied by remember { mutableStateOf(false) }
    val s = rememberSkill(a, now)
    val pending = rememberPending(group, a, now)
    val run = runInfo(a, now)
    Title("运行")
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Line("上次运行", a.lastRun?.let { "${CLOCK.format(Date(it))} (${ago(it, now)})" } ?: "还没有")
        TriggerLines(a, run, now)
        pending?.let { Line("待处理", "$it 条") }
    }
    Title("skill")
    when (s.gap) {
        SkillGap.SAME -> Line("状态", "最新 · " + (a.skills?.skills?.entries?.joinToString(", ") { "${it.key} ${it.value}" } ?: ""))
        SkillGap.MINOR -> Line("状态", "小更新待生效, Agent 下一轮自己重装")
        SkillGap.MAJOR -> MajorList(s)
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text("大更新自动执行", fontSize = 14.sp)
            Text("开着时 Agent 遇到大更新自己运行 hxaioa upgrade; 触发语和定时间隔的改动仍只提示。", fontSize = 12.sp, color = c.outline)
        }
        Switch(a.autoMajor, { confirm = it })
    }
    val copy = {
        scope.launch { dir.savedPrompt(group, a.keyId).onSuccess { clipboard.setText(AnnotatedString(it)); copied = true }.onFailure { dir.error = it.message } }
        Unit
    }
    val label = if (copied) "已复制新接入语" else "复制新接入语"
    if (s.gap == SkillGap.MAJOR) Button(copy) { Text(label) } else OutlinedButton(copy) { Text(label) }
    confirm?.let { on ->
        AlertDialog(
            onDismissRequest = { confirm = null },
            title = { Text(if (on) "开启大更新自动执行?" else "关闭大更新自动执行?") },
            text = { Text(TXT_SWITCH_HINT) },
            confirmButton = { TextButton({ scope.launch { dir.setAutoMajor(group, a.keyId, on)?.let { dir.error = it } }; copied = false; confirm = null }) { Text(if (on) "开启" else "关闭") } },
            dismissButton = { TextButton({ confirm = null }) { Text("取消") } },
        )
    }
}

@Composable
private fun MajorList(s: SkillStatus) {
    val c = MaterialTheme.colorScheme
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Line("状态", if (s.legacy) "$TXT_RELINK: 还没上报已装版本" else TXT_RELINK, true)
        if (s.setupHave != null && s.setupHave != s.setupWant) Line("接入版本", "${s.setupHave} -> ${s.setupWant}")
        s.missing.forEach { m ->
            Line(m.id, "${m.have ?: "未装"} -> ${m.want}" + (m.deadline?.let { " · 兼容到 ${dateText(it)}" } ?: ""), true)
            m.changes.forEach { ch ->
                Text("${ch.version}: ${ch.changes}", fontSize = 12.sp, modifier = Modifier.padding(start = 88.dp))
                if (ch.missing.isNotBlank()) Text("不升级会少: ${ch.missing}", fontSize = 12.sp, color = c.outline, modifier = Modifier.padding(start = 88.dp))
            }
        }
    }
}

@Composable
private fun Title(text: String) = Text(text, fontSize = 13.sp, fontWeight = FontWeight.Medium)

@Composable
private fun Line(label: String, value: String, alert: Boolean = false) {
    val c = MaterialTheme.colorScheme
    Row {
        Text(label, fontSize = 14.sp, modifier = Modifier.width(88.dp))
        Text(value, fontSize = 13.sp, color = if (alert) c.error else c.outline)
    }
}
