package com.hengxin.aioa.link

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.annotation.DrawableRes
import androidx.core.app.NotificationCompat
import com.hengxin.aioa.Constants
import com.hengxin.aioa.R
import com.hengxin.aioa.proto.Envelope
import com.hengxin.aioa.proto.TaskSnapshot
import com.hengxin.aioa.proto.plainLine
import com.hengxin.aioa.proto.plainText

/** v1 事件按内容分样式: 告警, GitHub, Agent 待确认, 报告。loud 为 false 时只更新已有通知, 不新弹。 */
class EventNotifier(private val context: Context) {

    fun isAlert(ev: Envelope): Boolean =
        ev.kind == Constants.KIND_EVENT &&
            (ev.severity == Constants.SEVERITY_CRITICAL || ev.severity == Constants.SEVERITY_WARNING || ev.priority == Constants.PRIORITY_NEED_ME)

    fun isGithub(ev: Envelope): Boolean =
        ev.source.type == Constants.SOURCE_GITHUB || ev.subject?.startsWith(GITHUB_SUBJECT) == true

    /** 带去重键的事件恢复时, 把同一条告警改成 "已恢复"; 返回 true 表示已处理。 */
    fun recover(ev: Envelope): Boolean {
        val key = ev.dedupeKey ?: return false
        if (!ev.resolved || !active(alertTag(key), Constants.NOTIFY_ID_ALERT)) return false
        val icon = if (isGithub(ev)) R.drawable.ic_stat_github else R.drawable.ic_stat_alert
        val (repo, text) = githubTitle(ev)
        val n = NotifyKit.builder(context, Constants.CHANNEL_ALERT, icon)
            .setContentTitle(context.getString(R.string.notify_resolved_title, repo ?: ev.source.name))
            .setContentText(text)
            .setSubText(context.getString(R.string.notify_resolved))
            .setColor(NotifyKit.color(context, R.color.notify_resolved))
            .setContentIntent(NotifyKit.openUrl(context, ev.url))
            .setGroup(Constants.GROUP_ALERT)
            .setWhen(ev.ts)
            .setAutoCancel(true)
            .setSilent(true)
            .build()
        NotifyKit.post(context, alertTag(key), Constants.NOTIFY_ID_ALERT, n)
        alertSummary(alertTag(key) to NotifyKit.line(repo ?: ev.source.name, text))
        return true
    }

    fun alert(ev: Envelope) {
        val critical = ev.severity == Constants.SEVERITY_CRITICAL
        val github = isGithub(ev)
        val (repo, text) = githubTitle(ev)
        val n = NotifyKit.builder(context, Constants.CHANNEL_ALERT, if (github) R.drawable.ic_stat_github else R.drawable.ic_stat_alert)
            .setContentTitle(repo ?: ev.source.name)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body(text, ev.summary)))
            .setColor(NotifyKit.color(context, if (critical) R.color.notify_critical else R.color.notify_warning))
            .setContentIntent(NotifyKit.openUrl(context, ev.url))
            .setGroup(Constants.GROUP_ALERT)
            .setWhen(ev.ts)
            .setAutoCancel(true)
            .setOnlyAlertOnce(false)
            .setCategory(NotificationCompat.CATEGORY_ERROR)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setVibrate(Constants.VIBRATE_PATTERN)
            .build()
        val tag = alertTag(ev.dedupeKey ?: ev.id)
        NotifyKit.post(context, tag, Constants.NOTIFY_ID_ALERT, n)
        alertSummary(tag to NotifyKit.line(repo ?: ev.source.name, text))
    }

    fun github(ev: Envelope) {
        val (repo, text) = githubTitle(ev)
        val n = NotifyKit.builder(context, Constants.CHANNEL_GITHUB, R.drawable.ic_stat_github)
            .setContentTitle(repo ?: ev.source.name)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body(text, ev.summary)))
            .setContentIntent(NotifyKit.openUrl(context, ev.url))
            .setGroup(Constants.GROUP_EVENT)
            .setWhen(ev.ts)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_SOCIAL)
            .build()
        // 同一个 PR 或 Issue 的后续事件覆盖同一条
        val tag = GITHUB_TAG + (ev.dedupeKey ?: ev.id)
        NotifyKit.post(context, tag, Constants.NOTIFY_ID_EVENT, n)
        eventSummary(tag to NotifyKit.line(repo ?: ev.source.name, text))
    }

    fun report(ev: Envelope) {
        val title = plainLine(ev.title)
        val summary = ev.summary?.let(::plainText)?.ifBlank { null }
        val n = NotifyKit.builder(context, Constants.CHANNEL_REPORT, R.drawable.ic_stat_report)
            .setContentTitle(title)
            .setContentText(summary?.let(::plainLine) ?: ev.source.name)
            .setSubText(ev.source.name)
            .setStyle(NotificationCompat.BigTextStyle().bigText(summary ?: title).setBigContentTitle(title))
            .setContentIntent(NotifyKit.openUrl(context, ev.url))
            .setGroup(Constants.GROUP_EVENT)
            .setWhen(ev.ts)
            .setAutoCancel(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_RECOMMENDATION)
            .build()
        val tag = REPORT_TAG + (ev.dedupeKey ?: ev.id)
        NotifyKit.post(context, tag, Constants.NOTIFY_ID_EVENT, n)
        eventSummary(tag to NotifyKit.line(title, summary?.let(::plainLine)))
    }

    /** 任务快照: 等待确认且允许弹出时发带按钮的通知; 一旦不再等待就撤掉。 */
    fun task(task: TaskSnapshot, agentName: String, loud: Boolean) {
        val tag = taskTag(task.id)
        val prompt = task.prompt
        if (task.state != Constants.TASK_WAITING || prompt == null || prompt.expired) {
            if (active(tag, Constants.NOTIFY_ID_AGENT)) {
                NotifyKit.cancel(context, tag, Constants.NOTIFY_ID_AGENT)
                agentSummary(atLeast = 0, except = tag)
            }
            return
        }
        if (!loud) return
        val text = plainLine(prompt.question.ifEmpty { task.title })
        val b = NotifyKit.builder(context, Constants.CHANNEL_AGENT, R.drawable.ic_stat_agent)
            .setContentTitle(context.getString(R.string.notify_agent_title, agentName))
            .setContentText(text)
            .setSubText(plainLine(task.title))
            .setStyle(NotificationCompat.BigTextStyle().bigText(body(text, task.summary)))
            .setContentIntent(NotifyKit.openApp(context))
            .setGroup(Constants.GROUP_AGENT)
            .setWhen(task.updated)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVibrate(Constants.VIBRATE_PATTERN)
        // 危险动作服务端要求二次确认, 通知里不给一键批准, 只能进 App 处理
        if (prompt.danger) {
            b.setSubText(context.getString(R.string.notify_agent_danger))
            b.addAction(0, context.getString(R.string.notify_open), NotifyKit.openApp(context))
        } else {
            b.addAction(0, context.getString(R.string.notify_approve), act(task.id, Constants.ACT_APPROVE))
        }
        b.addAction(0, context.getString(R.string.notify_reject), act(task.id, Constants.ACT_REJECT))
        NotifyKit.post(context, tag, Constants.NOTIFY_ID_AGENT, b.build())
        agentSummary(latest = tag to NotifyKit.line(context.getString(R.string.notify_agent_title, agentName), text))
    }

    private fun act(taskId: String, kind: String): PendingIntent {
        val intent = Intent(Constants.ACTION_AGENT_ACT)
            .setClass(context, AgentActionReceiver::class.java)
            .putExtra(AgentActionReceiver.EXTRA_TASK, taskId)
            .putExtra(AgentActionReceiver.EXTRA_KIND, kind)
        return PendingIntent.getBroadcast(context, (taskId + kind).hashCode(), intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    fun agentSummary(atLeast: Int = 1, except: String? = null, latest: Pair<String, String>? = null) = NotifyKit.summary(
        context, Constants.CHANNEL_AGENT, R.drawable.ic_stat_agent, Constants.GROUP_AGENT, SUMMARY_AGENT,
        context.getString(R.string.notify_group_agent), atLeast, except, latest,
    )

    private fun alertSummary(latest: Pair<String, String>) =
        summary(Constants.CHANNEL_ALERT, R.drawable.ic_stat_alert, Constants.GROUP_ALERT, R.string.notify_group_alert, SUMMARY_ALERT, latest)

    private fun eventSummary(latest: Pair<String, String>) =
        summary(Constants.CHANNEL_GITHUB, R.drawable.ic_stat_app, Constants.GROUP_EVENT, R.string.notify_group_event, SUMMARY_EVENT, latest)

    private fun summary(channel: String, @DrawableRes icon: Int, group: String, title: Int, id: Int, latest: Pair<String, String>) =
        NotifyKit.summary(context, channel, icon, group, id, context.getString(title), latest = latest)

    private fun active(tag: String, id: Int): Boolean =
        context.getSystemService(NotificationManager::class.java).activeNotifications.any { it.tag == tag && it.id == id }

    // 服务端的 GitHub 标题形如 "[仓库] 内容": 拆成标题 "[仓库]" 与正文
    private fun githubTitle(ev: Envelope): Pair<String?, String> {
        val title = plainLine(ev.title)
        val m = REPO_PREFIX.find(title) ?: return (if (isGithub(ev)) repoOf(ev) else null) to title
        return m.groupValues[1] to m.groupValues[2]
    }

    private fun repoOf(ev: Envelope): String? = ev.subject?.removePrefix(GITHUB_SUBJECT)?.let { "[$it]" }

    // 展开后的全文: 摘要去掉 Markdown / HTML 标记, 和标题重复的就不再写一遍
    private fun body(text: String, extra: String?): String {
        val more = extra?.let(::plainText)?.takeIf { it.isNotBlank() && it != text } ?: return text
        return if (more.startsWith(text)) more else "$text\n$more"
    }

    private fun alertTag(key: String) = ALERT_TAG + key

    companion object {
        private const val GITHUB_SUBJECT = "github:"
        private const val ALERT_TAG = "alert:"
        private const val GITHUB_TAG = "gh:"
        private const val REPORT_TAG = "report:"
        private const val TASK_TAG = "task:"
        // 组摘要的 id, 与各类子通知的 id 错开
        private const val SUMMARY_ALERT = 104
        private const val SUMMARY_AGENT = 105
        private const val SUMMARY_EVENT = 106
        private val REPO_PREFIX = Regex("^(\\[[^\\]]+\\])\\s*(.*)$", RegexOption.DOT_MATCHES_ALL)

        fun taskTag(taskId: String) = TASK_TAG + taskId
    }
}
