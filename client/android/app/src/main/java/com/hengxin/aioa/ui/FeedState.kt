package com.hengxin.aioa.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.hengxin.aioa.Constants
import com.hengxin.aioa.proto.AgentStatus
import com.hengxin.aioa.proto.Envelope
import com.hengxin.aioa.proto.Frames
import com.hengxin.aioa.proto.Overview
import com.hengxin.aioa.proto.OverviewItem
import com.hengxin.aioa.proto.ServerFrame
import com.hengxin.aioa.proto.TaskSnapshot
import java.util.UUID

private const val LAYER_MAX = 20

/** 总览与 Agent 页的界面状态: v1 流的 overview 快照打底, 之后的 ev / task 帧实时合并。只在界面进程使用。 */
class FeedState(private val send: (String) -> Boolean, private val save: (String) -> Unit = {}) {
    /** 服务端是否支持 v1; 旧 /ws 端点时总览退回由消息推断。 */
    var v1 by mutableStateOf(false)
        private set
    var loaded by mutableStateOf(false)
        private set
    var updatedAt by mutableLongStateOf(0L)
        private set
    var notice by mutableStateOf<String?>(null)
        private set
    val layers = mutableStateMapOf<String, List<OverviewItem>>()
    val tasks = mutableStateMapOf<String, TaskSnapshot>()
    var agents by mutableStateOf<List<AgentStatus>>(emptyList())
        private set
    /** taskId -> 已提交还没回执的选项 id。 */
    val pending = mutableStateMapOf<String, String>()
    private val actions = HashMap<String, String>()

    /** 用上次缓存的总览打底, 打开就有内容; 连上后服务端的快照会替换它。 */
    fun restore(o: Overview) {
        if (loaded) return
        apply(o)
        updatedAt = o.generatedAt
    }

    // 只替换变了的层, 没变的层不触发重绘; 列表按 id 增量显示
    private fun apply(o: Overview) {
        (layers.keys - o.layers.keys).forEach { layers.remove(it) }
        o.layers.forEach { (k, v) -> if (layers[k] != v) layers[k] = v }
        (tasks.keys - o.tasks.map { it.id }.toSet()).forEach { tasks.remove(it) }
        o.tasks.forEach { if (tasks[it.id] != it) tasks[it.id] = it }
        loaded = true
        touch()
    }

    fun onFrame(frame: ServerFrame): Boolean {
        when (frame) {
            is ServerFrame.Welcome -> {
                v1 = frame.v > 0
                if (v1) send(Frames.overview()) else loaded = true
                return false
            }
            is ServerFrame.OverviewFrame -> {
                apply(frame.overview)
                if (frame.raw.isNotEmpty()) save(frame.raw)
            }
            is ServerFrame.Ev -> merge(frame.ev)
            is ServerFrame.Task -> {
                tasks[frame.task.id] = frame.task
                touch()
            }
            is ServerFrame.Agents -> agents = frame.agents
            is ServerFrame.ActOk -> settle(frame.aid, if (frame.state == STATE_QUEUED) "Agent 离线, 已排队, 上线后送达" else null)
            is ServerFrame.Err -> {
                val aid = frame.aid ?: return false
                settle(aid, "操作失败: ${frame.text}")
            }
            else -> return false
        }
        return true
    }

    /** 回答任务的等待确认; 返回 false 表示没发出去 (离线)。 */
    fun act(taskId: String, kind: String, option: String?, confirm: Boolean, text: String? = null): Boolean {
        val aid = "a_" + UUID.randomUUID().toString().replace("-", "").take(AID_LENGTH)
        if (!send(Frames.act(aid, taskId, kind, option, text, confirm))) {
            notice = "未连接服务端, 操作没有发出"
            return false
        }
        actions[aid] = taskId
        pending[taskId] = option ?: kind
        notice = null
        return true
    }

    fun dismissNotice() {
        notice = null
    }

    private fun settle(aid: String, message: String?) {
        val taskId = actions.remove(aid) ?: return
        pending.remove(taskId)
        notice = message
    }

    // 同 id 整体替换; 已恢复的事件从 "需要我" 移走; 每层只保留最新的若干条
    private fun merge(ev: Envelope) {
        ev.task?.let { tasks[it.id] = it }
        if (ev.kind == Constants.KIND_METRIC) return
        layers.keys.toList().forEach { key -> layers[key] = layers[key].orEmpty().filter { it.ev.id != ev.id } }
        val target = if (ev.resolved && ev.priority == Constants.PRIORITY_NEED_ME) Constants.PRIORITY_HAPPENING else ev.priority
        layers[target] = (listOf(OverviewItem(ev, 1, listOf(ev.id))) + layers[target].orEmpty()).take(LAYER_MAX)
        touch()
    }

    private fun touch() {
        updatedAt = System.currentTimeMillis()
    }

    private companion object {
        const val STATE_QUEUED = "queued"
        const val AID_LENGTH = 16
    }
}
