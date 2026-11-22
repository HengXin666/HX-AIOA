package com.hengxin.aioa.ui

import android.text.format.DateUtils
import com.hengxin.aioa.Constants
import com.hengxin.aioa.kit.ButtonStyle
import com.hengxin.aioa.kit.FeedItem
import com.hengxin.aioa.kit.TaskCardData
import com.hengxin.aioa.kit.TaskOption
import com.hengxin.aioa.kit.TaskPhase
import com.hengxin.aioa.kit.Tone
import com.hengxin.aioa.proto.OverviewItem
import com.hengxin.aioa.proto.TaskSnapshot

// 协议对象到组件展示数据的转换, 组件库不认识协议

fun ago(ts: Long, now: Long = System.currentTimeMillis()): String =
    if (ts <= 0) "" else DateUtils.getRelativeTimeSpanString(ts, now, DateUtils.MINUTE_IN_MILLIS).toString()

fun OverviewItem.toFeed(): FeedItem {
    val tone = when (ev.severity) {
        Constants.SEVERITY_CRITICAL -> Tone.Critical
        Constants.SEVERITY_WARNING -> Tone.Warning
        else -> if (ev.kind == Constants.KIND_REPORT) Tone.Info else Tone.Normal
    }
    val icon = when (ev.kind) {
        Constants.KIND_TASK -> Constants.ICON_ACTIVITY
        Constants.KIND_REPORT -> "sun"
        else -> ev.source.icon ?: if (tone == Tone.Critical || tone == Tone.Warning) "alert-triangle" else "bell"
    }
    val title = if (ev.resolved) "已恢复: ${ev.title}" else ev.title
    return FeedItem(ev.id, icon, title, ev.summary, ev.source.name, ago(ev.ts), if (ev.resolved) Tone.Info else tone, count)
}

fun TaskSnapshot.phase(): TaskPhase = when (state) {
    Constants.TASK_WAITING -> TaskPhase.Waiting
    Constants.TASK_DONE -> TaskPhase.Done
    Constants.TASK_FAILED -> TaskPhase.Failed
    Constants.TASK_CANCELLED -> TaskPhase.Cancelled
    else -> TaskPhase.Running
}

/** 等待确认但 Agent 没给选项时, 提供默认的 批准 / 拒绝。 */
private val DEFAULT_OPTIONS = listOf(
    TaskOption(Constants.ACT_APPROVE, "批准", ButtonStyle.Primary),
    TaskOption(Constants.ACT_REJECT, "拒绝"),
)

fun TaskSnapshot.options(): List<TaskOption> {
    val given = prompt?.options.orEmpty().map {
        val style = when (it.style) {
            Constants.STYLE_DANGER -> ButtonStyle.Danger
            Constants.STYLE_PRIMARY -> ButtonStyle.Primary
            else -> ButtonStyle.Plain
        }
        TaskOption(it.id, it.label, style)
    }
    return given.ifEmpty { DEFAULT_OPTIONS }
}

fun TaskSnapshot.toCard(pending: String?): TaskCardData = TaskCardData(
    id = id,
    agent = agent.ifEmpty { "Agent" },
    title = title,
    phase = phase(),
    updated = ago(updated),
    summary = summary,
    progress = progress?.toFloat(),
    step = step,
    question = prompt?.question,
    options = options(),
    danger = prompt?.danger == true,
    expired = prompt?.expired == true || (prompt?.expires ?: Long.MAX_VALUE) < System.currentTimeMillis(),
    result = result ?: error,
    pending = pending,
)

/** 默认选项映射成 approve / reject 动作, Agent 自定义的选项一律以 approve + option 提交。 */
fun actionOf(option: TaskOption): Pair<String, String?> = when (option.id) {
    Constants.ACT_APPROVE -> Constants.ACT_APPROVE to null
    Constants.ACT_REJECT -> Constants.ACT_REJECT to null
    else -> Constants.ACT_APPROVE to option.id
}
