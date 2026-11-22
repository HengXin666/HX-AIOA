package com.hengxin.aioa.gallery

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.ButtonStyle
import com.hengxin.aioa.kit.Card
import com.hengxin.aioa.kit.CardState
import com.hengxin.aioa.kit.FeedItem
import com.hengxin.aioa.kit.LayerSection
import com.hengxin.aioa.kit.ReleaseNotesView
import com.hengxin.aioa.kit.TaskCard
import com.hengxin.aioa.kit.TaskCardData
import com.hengxin.aioa.kit.TaskOption
import com.hengxin.aioa.kit.TaskPhase
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.Tone

private val NEED_ME = listOf(
    FeedItem("e1", "alert-triangle", "磁盘 sda 故障", "SMART 报告 12 个重映射扇区", "群晖 NAS", "2 分钟前", Tone.Critical),
    FeedItem("e2", "server", "vps-1 掉线", "容器离线 3 个, 网站不可达", "探针", "8 分钟前", Tone.Warning, count = 4),
)
private val HAPPENING = listOf(
    FeedItem("e3", "activity", "HX-AIOA 新提交 5 条", "AI 归纳: 安卓省电与协议 v1", "GitHub", "1 小时前"),
    FeedItem("e4", "cpu", "nas-01 CPU 回落到 23%", null, "探针", "刚刚", Tone.Info),
)
private val READING = listOf(FeedItem("e5", "sun", "本周运维周报", "3 次告警, 均已恢复", "Agent", "今天 09:00", Tone.Info))

private fun waitingTask(pending: String?) = TaskCardData(
    id = "deploy-42", agent = "DSH", title = "部署到生产", phase = TaskPhase.Waiting, updated = "1 分钟前",
    summary = "镜像已推送, 健康检查通过", question = "切换生产流量?",
    options = listOf(TaskOption("go", "切换", ButtonStyle.Danger), TaskOption("hold", "先不")),
    danger = true, pending = pending,
)

private val RUNNING_TASK = TaskCardData(
    id = "backup", agent = "DSH", title = "夜间备份", phase = TaskPhase.Running, updated = "刚刚", progress = 0.4f, step = "上传快照",
)

/** 三层总览: 需要我 / 正在发生 / 值得一看。 */
@Composable
fun FeedOverview() {
    var pending by remember { mutableStateOf<String?>(null) }
    Column(verticalArrangement = Arrangement.spacedBy(Aioa.metrics.gap)) {
        Text("总览", Aioa.colors.text, 26)
        TaskCard(waitingTask(pending), onOption = { pending = it.id })
        LayerSection("需要我", "少而重要", NEED_ME, CardState.Ready, "没有需要处理的事")
        LayerSection("正在发生", "值得知道", HAPPENING, CardState.Ready, "暂时风平浪静")
        LayerSection("值得一看", "每次一小批", READING, CardState.Ready, "今天没有新内容")
    }
}

/** Agent 页与各组件的空 / 加载 / 错误 / 过期状态。 */
@Composable
fun AgentStates() {
    Column(verticalArrangement = Arrangement.spacedBy(Aioa.metrics.gap)) {
        Text("Agent", Aioa.colors.text, 26)
        TaskCard(RUNNING_TASK)
        TaskCard(RUNNING_TASK.copy(id = "t2", phase = TaskPhase.Failed, result = "健康检查失败"))
        TaskCard(RUNNING_TASK, state = CardState.Stale("10 分钟前"))
        LayerSection("需要我", "加载", emptyList(), CardState.Loading, "")
        LayerSection("正在发生", "错误", emptyList(), CardState.Error("未连接服务端"), "", onRetry = {})
        LayerSection("值得一看", "空", emptyList(), CardState.Ready, "今天没有新内容")
        Card { ReleaseNotesView("0.1.42", listOf("安卓: 代理内核按需启动", "安卓: 自适应心跳", "协议 v1: 事件与任务帧"), onClose = {}) }
    }
}
