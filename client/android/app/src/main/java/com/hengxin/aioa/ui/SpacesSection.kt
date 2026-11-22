package com.hengxin.aioa.ui

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.hengxin.aioa.Constants
import com.hengxin.aioa.kit.ANY_SUBJECT
import com.hengxin.aioa.kit.ButtonStyle
import com.hengxin.aioa.kit.ChatLine
import com.hengxin.aioa.kit.FeedItem
import com.hengxin.aioa.kit.LayoutChange
import com.hengxin.aioa.kit.METRIC_UNITS
import com.hengxin.aioa.kit.MetricSample
import com.hengxin.aioa.kit.ReportView
import com.hengxin.aioa.kit.Space
import com.hengxin.aioa.kit.SpaceBind
import com.hengxin.aioa.kit.SpaceBoard
import com.hengxin.aioa.kit.SpaceHandler
import com.hengxin.aioa.kit.SpaceItem
import com.hengxin.aioa.kit.SpaceSource
import com.hengxin.aioa.kit.TaskCardData
import com.hengxin.aioa.kit.TaskOption
import com.hengxin.aioa.proto.Envelope
import com.hengxin.aioa.proto.OverviewItem

/** 组件取数: 指标来自 watch 推送 + /data 首屏值, 事件与任务来自 v1 流, 对话按需拉历史。 */
private class AppSpaceSource(private val chat: ChatModel) : SpaceSource {
    private val feed get() = chat.feed
    override val ready: Boolean get() = feed.loaded
    override val error: String? get() = null
    override val now: Long get() = System.currentTimeMillis()

    override fun samples(bind: SpaceBind): List<MetricSample> =
        chat.metrics.samples[bind.subject].orEmpty().mapNotNull { p -> p.values[bind.field]?.let { MetricSample(p.ts, it.toFloat()) } }

    override fun unit(bind: SpaceBind): String = METRIC_UNITS[bind.field].orEmpty()

    private fun envelopes(subject: String): List<Envelope> =
        (feed.layers.values.flatten().map { it.ev } + chat.spaces.events.values)
            .filter { it.kind != Constants.KIND_METRIC && it.kind != Constants.KIND_TASK && (subject == ANY_SUBJECT || it.subject == subject) }
            .distinctBy { it.id }
            .sortedByDescending { it.ts }

    override fun events(subject: String): List<FeedItem> = envelopes(subject).map { OverviewItem(it, 1, listOf(it.id)).toFeed() }

    override fun report(subject: String): ReportView? = envelopes(subject).firstOrNull { it.kind == Constants.KIND_REPORT }?.let {
        ReportView(it.title, it.summary, "${it.source.name} · ${ago(it.ts)}")
    }

    override fun tasks(): List<TaskCardData> = feed.tasks.values.sortedByDescending { it.updated }.map { it.toCard(feed.pending[it.id]) }

    override fun chat(taskId: String): List<ChatLine> = chat.spaces.chat(taskId)

    override fun clock(ts: Long): String = com.hengxin.aioa.ui.clock(ts)
}

/** 资源页顶部的工作台: 与 Web 渲染同一份 schema; 危险按钮与危险选项先二次确认。 */
@Composable
fun SpacesSection(chat: ChatModel) {
    val spaces = chat.spaces
    val source = remember(chat) { AppSpaceSource(chat) }
    var confirm by remember { mutableStateOf<Pair<String, () -> Unit>?>(null) }
    confirm?.let { (text, run) ->
        AlertDialog(
            onDismissRequest = { confirm = null },
            title = { Text("确认执行?") },
            text = { Text("$text。这会触发真实操作。") },
            confirmButton = { TextButton(onClick = { confirm = null; run() }) { Text("执行") } },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text("取消") } },
        )
    }
    val handler = remember(chat) {
        object : SpaceHandler {
            override fun press(space: Space, item: SpaceItem) {
                val a = item.action ?: return
                val taskId = "${Constants.BUTTON_TASK_PREFIX}${space.id}:${item.id}"
                val send = { danger: Boolean -> chat.feed.act(taskId, Constants.ACT_REPLY, null, danger, a.command); Unit }
                if (a.danger) confirm = "${item.title ?: a.command} (${a.agent})" to { send(true) } else send(false)
            }

            override fun option(task: TaskCardData, option: TaskOption) {
                val (kind, picked) = actionOf(option)
                val danger = task.danger || option.style == ButtonStyle.Danger
                val send = { chat.feed.act(task.id, kind, picked, danger); Unit }
                if (danger) confirm = "${task.title}: ${option.label}" to send else send()
            }

            override fun ask(taskId: String, text: String) {
                if (chat.feed.act(taskId, Constants.ACT_ASK, null, false, text)) chat.spaces.appendMine(taskId, text)
            }

            override fun layout(space: Space, change: LayoutChange) = chat.spaces.change(space, change)
        }
    }
    val current = spaces.currentId ?: spaces.spaces.firstOrNull()?.id
    LaunchedEffect(current) { current?.let(spaces::prime) }
    SpaceBoard(spaces.spaces, current, spaces.editing, source, handler, onPick = spaces::pick, onEdit = { spaces.editing = it })
}
