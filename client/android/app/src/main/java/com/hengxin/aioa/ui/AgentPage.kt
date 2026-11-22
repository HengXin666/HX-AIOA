package com.hengxin.aioa.ui

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.hengxin.aioa.Constants
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.ButtonStyle
import com.hengxin.aioa.kit.Card
import com.hengxin.aioa.kit.CardState
import com.hengxin.aioa.kit.Chip
import com.hengxin.aioa.kit.Paragraph
import com.hengxin.aioa.kit.StateBody
import com.hengxin.aioa.kit.TaskCard
import com.hengxin.aioa.kit.TaskOption
import com.hengxin.aioa.proto.TaskSnapshot
import com.hengxin.aioa.kit.Text as KitText

private val ACTIVE = setOf(Constants.TASK_WAITING, Constants.TASK_RUNNING)

/** Agent 页: 等待确认在最上, 然后是运行中, 最后是已结束的任务; 卡片上直接批准 / 拒绝。 */
@Composable
fun AgentPage(chat: ChatModel) {
    val feed = chat.feed
    val answer = rememberAnswer(chat)
    val state = layerState(chat.online, feed.loaded, feed.updatedAt)
    val all = feed.tasks.values.sortedWith(compareBy<TaskSnapshot>({ rank(it.state) }, { -it.updated }))
    PageColumn("Agent") {
        feed.notice?.let { text ->
            Card {
                Paragraph(text, Aioa.colors.warning, 14)
                Chip("知道了", false) { feed.dismissNotice() }
            }
        }
        if (!feed.v1 && feed.loaded) {
            Card { KitText("服务端还没有升级到 v1 协议, 暂时看不到 Agent 任务", Aioa.colors.textSecondary, 14) }
            return@PageColumn
        }
        if (feed.agents.isNotEmpty()) {
            Card { feed.agents.forEach { a -> Chip("${a.name} ${if (a.online) "在线" else "离线"}", a.online) {} } }
        }
        PageSection("进行中")
        val active = all.filter { it.state in ACTIVE }
        if (active.isEmpty() || state != CardState.Ready) {
            Card { StateBody(if (state == CardState.Ready) CardState.Empty else state, "没有进行中的任务") {} }
        }
        active.forEach { task -> TaskCard(task.toCard(feed.pending[task.id]), stateOf(state), onOption = { answer(task, it) }) }
        val ended = all.filter { it.state !in ACTIVE }
        if (ended.isNotEmpty()) PageSection("已结束")
        ended.forEach { task -> TaskCard(task.toCard(null), stateOf(state)) }
    }
}

// 过期时任务卡变淡并标注, 其他非正常状态已在列表顶部提示, 卡片本身照常显示
private fun stateOf(page: CardState): CardState = if (page is CardState.Stale) page else CardState.Ready

private fun rank(state: String): Int = when (state) {
    Constants.TASK_WAITING -> 0
    Constants.TASK_RUNNING -> 1
    else -> 2
}

/** 回答等待确认的任务; 危险操作先弹二次确认, 确认后带 confirm 提交。 */
@Composable
fun rememberAnswer(chat: ChatModel): (TaskSnapshot, TaskOption) -> Unit {
    var asking by remember { mutableStateOf<Pair<TaskSnapshot, TaskOption>?>(null) }
    asking?.let { (task, option) ->
        AlertDialog(
            onDismissRequest = { asking = null },
            title = { Text("确认执行?") },
            text = { Text("${task.title}: ${option.label}。这会触发真实操作。") },
            confirmButton = {
                TextButton(onClick = { asking = null; chat.answer(task, option, confirm = true) }) { Text(option.label) }
            },
            dismissButton = { TextButton(onClick = { asking = null }) { Text("取消") } },
        )
    }
    return { task, option ->
        val danger = task.prompt?.danger == true || option.style == ButtonStyle.Danger
        if (danger) asking = task to option else chat.answer(task, option, confirm = false)
    }
}
