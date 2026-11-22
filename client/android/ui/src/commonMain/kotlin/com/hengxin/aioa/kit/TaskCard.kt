package com.hengxin.aioa.kit

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/** 任务状态, 与协议 TaskState 一一对应。 */
enum class TaskPhase(val label: String) {
    Running("运行中"),
    Waiting("等待确认"),
    Done("完成"),
    Failed("失败"),
    Cancelled("已取消"),
}

enum class ButtonStyle { Primary, Danger, Plain }

data class TaskOption(val id: String, val label: String, val style: ButtonStyle = ButtonStyle.Plain)

/** 任务卡的展示数据; 调用方负责从协议快照转换, 组件不认识协议。 */
data class TaskCardData(
    val id: String,
    val agent: String,
    val title: String,
    val phase: TaskPhase,
    val updated: String,
    val summary: String? = null,
    val progress: Float? = null,
    val step: String? = null,
    val question: String? = null,
    val options: List<TaskOption> = emptyList(),
    val danger: Boolean = false,
    val expired: Boolean = false,
    val result: String? = null,
    /** 已提交但服务端还没回执的选项, 期间按钮禁用防止重复提交。 */
    val pending: String? = null,
)

private val BUTTON_SHAPE = RoundedCornerShape(50)
private const val DISABLED_ALPHA = 0.4f

/** 胶囊按钮: 主按钮黑底白字 (暗色反转), 危险按钮用 danger 色。 */
@Composable
fun PillButton(label: String, style: ButtonStyle, enabled: Boolean = true, onClick: () -> Unit) {
    val c = Aioa.colors
    val (bg, fg) = when (style) {
        ButtonStyle.Primary -> c.accent to c.onAccent
        ButtonStyle.Danger -> c.danger to contrastOn(c.danger)
        ButtonStyle.Plain -> c.surfaceAlt to c.text
    }
    Box(
        Modifier.alpha(if (enabled) 1f else DISABLED_ALPHA).pressable(if (enabled) onClick else null)
            .clip(BUTTON_SHAPE).background(bg).padding(horizontal = 16.dp, vertical = 8.dp),
    ) { Text(label, fg, 14, weight = FontWeight.Medium) }
}

/** 细进度条, 只画两层圆角矩形。 */
@Composable
fun ProgressBar(value: Float) {
    val c = Aioa.colors
    Box(Modifier.fillMaxWidth().height(4.dp).clip(BUTTON_SHAPE).background(c.surfaceAlt)) {
        Box(Modifier.fillMaxWidth(value.coerceIn(0f, 1f)).height(4.dp).clip(BUTTON_SHAPE).background(c.accent))
    }
}

/** Agent 任务卡: 状态, 进度, 等待确认时给出选项按钮; onOption 收到选项 id。 */
@Composable
fun TaskCard(data: TaskCardData, state: CardState = CardState.Ready, onOption: ((TaskOption) -> Unit)? = null, onClick: (() -> Unit)? = null) {
    val c = Aioa.colors
    Card(onClick = onClick) {
        CardHeader(if (data.phase == TaskPhase.Waiting) "bell" else "activity", data.agent, data.updated)
        StateBody(state) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(data.title, c.text, 16, Modifier.weight(1f), FontWeight.SemiBold)
                Text(data.phase.label, phaseColor(data.phase), 12)
            }
            data.summary?.let { Paragraph(it, c.textSecondary, 13, maxLines = 3) }
            if (data.phase == TaskPhase.Running) {
                data.progress?.let { ProgressBar(it) }
                data.step?.let { Text(it, c.textSecondary, 12) }
            }
            data.result?.let { Paragraph(it, if (data.phase == TaskPhase.Failed) c.danger else c.textSecondary, 13, maxLines = 3) }
            if (data.phase == TaskPhase.Waiting && data.question != null) Prompt(data, onOption)
        }
    }
}

@Composable
private fun Prompt(data: TaskCardData, onOption: ((TaskOption) -> Unit)?) {
    val c = Aioa.colors
    Paragraph(data.question.orEmpty(), c.text, 14)
    if (data.danger) Text("危险操作, 提交前会再次确认", c.danger, 12)
    if (data.expired) {
        Text("已超时, 无法再处理", c.warning, 12)
        return
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        data.options.forEach { option ->
            val label = if (data.pending == option.id) "${option.label}..." else option.label
            PillButton(label, option.style, enabled = data.pending == null && onOption != null) { onOption?.invoke(option) }
        }
    }
}

@Composable
private fun phaseColor(phase: TaskPhase) = when (phase) {
    TaskPhase.Waiting -> Aioa.colors.warning
    TaskPhase.Failed -> Aioa.colors.danger
    TaskPhase.Done -> Aioa.colors.success
    else -> Aioa.colors.textSecondary
}
