package com.hengxin.aioa.ui.agents

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.data.MessageDb
import com.hengxin.aioa.ui.chat.ChatAgent
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** 用过 skill 版接口的 Agent 才有这些字段; 旧指令 Agent 不显示 skill 区。 */
fun isSkillAgent(a: ChatAgent) = a.skills != null || a.setup != null || a.handled != null || a.trigger != null || a.lastRun != null

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

/** 列表行右边的图标式标注 (一行一条用): 小更新, 要重新接入, 待处理条数, 定时未运行; 文字版在 Agent 设置页。 */
@Composable
fun SkillMarks(group: String, a: ChatAgent, now: Long) {
    if (!isSkillAgent(a)) return
    val c = com.hengxin.aioa.kit.Aioa.colors
    val s = rememberSkill(a, now)
    val pending = rememberPending(group, a, now)
    when (s.gap) {
        SkillGap.SAME -> Unit
        SkillGap.MINOR -> com.hengxin.aioa.kit.Icon("download", c.accent, 12.dp)
        SkillGap.MAJOR -> com.hengxin.aioa.kit.Icon("alert-triangle", c.danger, 12.dp)
    }
    pending?.takeIf { it > 0 }?.let {
        com.hengxin.aioa.kit.Icon("inbox", c.textSecondary, 12.dp)
        Text("$it", fontSize = 11.sp, color = c.textSecondary)
    }
    if (runInfo(a, now)?.late == true) com.hengxin.aioa.kit.Icon("clock", c.danger, 12.dp)
}
