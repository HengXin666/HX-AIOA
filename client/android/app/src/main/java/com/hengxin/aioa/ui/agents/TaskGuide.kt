package com.hengxin.aioa.ui.agents

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// 接入向导第二步与接入后的引导 (#161): 任务怎么写, 定时不用选, 之后怎么继续布置
private val BOX = RoundedCornerShape(12.dp)

/** 任务模板: 名字与一句话任务, 都按 "什么时候算有事, 做什么, 结果什么样, 没事怎么办" 写。 */
data class TaskTemplate(val label: String, val task: String)

val TASK_TEMPLATES = listOf(
    TaskTemplate("回答提问", "我在群里问你的问题或让你做的事, 读完上下文后做完, 引用那条回复结论; 做不到就说原因和我能做的下一步。别人之间的闲聊不用回。"),
    TaskTemplate("整理待办", "我在群里说的要做的事整理成待办, 每条引用回复一句确认; 我说做完了就标完成。没有新的事就不出声。"),
    TaskTemplate("定时汇总", "每天把群里上次汇总之后的新消息总结成一条简报 (结论, 待我决定的事, 链接) 发到本群; 没有新消息就不发。"),
    TaskTemplate("盯一个来源", "盯着 <网址或仓库>, 出现 <什么情况> 时在群里发一条: 一句结论加链接, 要我马上处理的标成需要我; 没变化就不出声。"),
    TaskTemplate("自定义", ""),
)

private val TIPS = listOf(
    "什么时候算有事: 我在群里说话, 某个网页或仓库有变化, 每天固定时刻。",
    "做什么: 回答, 整理成待办, 汇总, 提醒, 去某处查一下。",
    "结果什么样: 一句结论, 清单, 带链接的简报; 要不要响铃 (需要我)。",
    "没事时怎么办: 写上 \"没有就不出声\", 最省额度也最不打扰。",
)

/** 第二步的说明区: 定时不用选的说明, 加一段可展开的 "任务怎么写"。 */
@Composable
fun TaskGuide() {
    val c = MaterialTheme.colorScheme
    var open by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().background(c.surfaceVariant.copy(alpha = 0.6f), BOX), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(Modifier.fillMaxWidth().clickable { open = !open }.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("任务怎么写", Modifier.weight(1f), fontSize = 14.sp, fontWeight = FontWeight.Medium)
            Text(if (open) "收起" else "看写法", fontSize = 12.sp, color = c.primary)
        }
        AnimatedVisibility(open) {
            Column(Modifier.padding(start = 12.dp, end = 12.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("像交代给同事一样, 一两句写清四件事:", fontSize = 13.sp)
                TIPS.forEachIndexed { i, t -> Text("${i + 1}. $t", fontSize = 13.sp, lineHeight = 19.sp) }
                Text("例: 盯着 HX-AIOA 的 issue, 有人提新 issue 时在群里发一条: 标题, 一句话说要做什么, 链接; 没有新的就不出声。", fontSize = 12.sp, lineHeight = 18.sp, color = c.outline)
            }
        }
    }
    Text("多久跑一次不用选: 它按事件集中的时段自动安排 (群里有人说话的时间, 或任务要盯的来源发新内容的时间), 闲时少跑, 没事时几乎不花额度。想要固定时刻 (如每天 9 点), 写进任务或之后在群里跟它说, 它照做并替你权衡。", fontSize = 12.sp, lineHeight = 18.sp, color = c.outline)
}

private fun nextSteps(name: String) = listOf(
    "有事直接在群里说, 或 @$name; 它下次醒来就处理并引用回复。",
    "长期的规矩 (偏好, 格式, 什么时候提醒你) 说一次, 它会记进长期记忆。",
    "想改定时或任务, 也在群里说; 换一个 Agent 就在 Agent 设置里重新接入。",
)

/** 接上之后: 怎么继续给它布置任务。 */
@Composable
fun NextSteps(name: String) {
    val c = MaterialTheme.colorScheme
    Column(Modifier.fillMaxWidth().background(c.surfaceVariant.copy(alpha = 0.6f), BOX).padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("接下来", fontSize = 14.sp, fontWeight = FontWeight.Medium)
        nextSteps(name).forEach { Text("· $it", fontSize = 13.sp, lineHeight = 19.sp) }
    }
}

// 接入语里的任务段 (#165), 与 protocol SETUP_TASK_MARK / SETUP_TASK_FILL / SETUP_TASK_KEEP 一致
private const val TASK_MARK = "要你做的事"
private const val TASK_FILL = "发出前把这一行换成你的任务"
private const val TASK_KEEP = "原来定时任务里写的任务, 原样保留"

/** 复制接入语前的提示: 没写任务时醒目地指到 "要你做的事" 那一段, 与 Web 的 TaskHint 一致。 */
@Composable
fun TaskHint(prompt: String) {
    val c = MaterialTheme.colorScheme
    val fill = TASK_FILL in prompt
    val text = when {
        fill -> "复制后先找到 \"$TASK_MARK\" 那一段 (两条 === 线中间), 把尖括号那一行换成你的任务再发。别加在最后, 不然它会当成一句普通的话。"
        TASK_KEEP in prompt -> "它会保留原来定时任务里写的任务, 不用重写; 想换任务就在群里跟它说。"
        TASK_MARK in prompt -> "任务已经写在 \"$TASK_MARK\" 那一段 (两条 === 线中间), 想改就改那一段再发。"
        else -> return
    }
    val bg = if (fill) c.errorContainer else c.surfaceVariant.copy(alpha = 0.6f)
    val fg = if (fill) c.onErrorContainer else c.onSurfaceVariant
    Column(Modifier.fillMaxWidth().background(bg, BOX).padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        if (fill) Text("先填任务再发", fontSize = 14.sp, fontWeight = FontWeight.Medium, color = fg)
        Text(text, fontSize = 13.sp, lineHeight = 19.sp, color = fg)
    }
}
