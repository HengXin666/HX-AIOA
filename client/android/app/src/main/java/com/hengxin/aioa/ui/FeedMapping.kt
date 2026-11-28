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
import com.hengxin.aioa.proto.plainLine
import com.hengxin.aioa.ui.chat.MailExtract
import com.hengxin.aioa.ui.chat.mailDigestOf
import org.json.JSONObject

// 协议对象到组件展示数据的转换, 组件库不认识协议

fun ago(ts: Long, now: Long = System.currentTimeMillis()): String =
    if (ts <= 0) "" else DateUtils.getRelativeTimeSpanString(ts, now, DateUtils.MINUTE_IN_MILLIS).toString()

fun OverviewItem.toFeed(now: Long = System.currentTimeMillis()): FeedItem {
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
    val plain = plainLine(ev.title)
    val title = if (ev.resolved) "已恢复: $plain" else plain
    // 列表里只放一两行摘要: 去掉 Markdown / HTML 标记, 点开再完整渲染; 和标题一样的不重复
    val summary = ev.summary?.let(::plainLine)?.takeIf { it.isNotBlank() && it != plain } ?: if (ev.html != null) "卡片, 点开查看" else null
    val item = FeedItem(ev.id, icon, title, summary, ev.source.name, ago(ev.ts), if (ev.resolved) Tone.Info else tone, count)
    return ev.mail?.let { mailFeed(item, it, now) } ?: item
}

/** 邮件 (#146): 用精简要点; 验证码信显示大号验证码与剩余时间, 不放摘要; 营销信只留标题。 */
private fun OverviewItem.mailFeed(item: FeedItem, json: String, now: Long): FeedItem? {
    val m = runCatching { JSONObject(json) }.getOrNull() ?: return null
    val d = mailDigestOf(m, ev.title, ev.summary.orEmpty(), ev.ts)
    val otp = d.otp
    if (otp != null) {
        val left = otp.expiresAt?.let { it - now }
        val note = left?.let { if (it > 0) "${(it + MINUTE_MS - 1) / MINUTE_MS} 分钟内有效" else "已过期" }
        return item.copy(summary = null, code = otp.code, codeNote = note, codeExpired = left != null && left <= 0)
    }
    if (d.kind == MailExtract.KIND_MARKETING) return item.copy(summary = null)
    return item.copy(summary = d.brief.ifEmpty { null }?.takeIf { it != item.title } ?: item.summary)
}

private const val MINUTE_MS = 60_000L

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
    agent = agent.ifEmpty { Constants.HARNESS },
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
