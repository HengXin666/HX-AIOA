package com.hengxin.aioa.ui.agents

import com.hengxin.aioa.Constants
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import com.hengxin.aioa.data.MessageDb
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.HomeRow
import com.hengxin.aioa.kit.HomeSection
import com.hengxin.aioa.kit.SoftTag
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.hxPalette
import com.hengxin.aioa.proto.ServerFrame
import com.hengxin.aioa.ui.ChatModel
import com.hengxin.aioa.ui.ChatPage
import com.hengxin.aioa.ui.chat.ChatAgent
import com.hengxin.aioa.ui.chat.plainPreview
import com.hengxin.aioa.ui.groupinfo.GiNote
import com.hengxin.aioa.ui.groupinfo.GiToggle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.time.Instant
import java.time.ZoneId
import java.util.Date
import java.util.Locale

// Agent 设置里只读的几块: 运行 (Agent 上报), 版本, 记录
private val CLOCK = SimpleDateFormat("MM-dd HH:mm", Locale.CHINA)
private const val RECENT = 5
private const val NOT_YET = "还没有"
private const val RELINK = "需重新接入"

private fun clock(ts: Long?, now: Long): String = ts?.let { "${CLOCK.format(Date(it))} (${ago(it, now)})" } ?: NOT_YET

/** 今天 (本机日界) 还会触发几次; upcoming 最多推 12 次, 够用。 */
private fun leftToday(upcoming: List<Long>, now: Long): Int {
    val zone = ZoneId.systemDefault()
    val today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
    return upcoming.count { Instant.ofEpochMilli(it).atZone(zone).toLocalDate() == today }
}

@Composable
fun AgentRunSection(group: String, a: ChatAgent, now: Long) {
    val c = Aioa.colors
    HomeSection("运行 (${Constants.CLOUD_AGENT} 上报)") {
        if (!isSkillAgent(a)) {
            GiNote("还没装 skill, 仍用旧的专属指令; 重新接入后改用 skill。")
            return@HomeSection
        }
        val run = runInfo(a, now)
        val t = a.trigger
        val tz = t?.tz?.let { " · $it" }.orEmpty()
        HomeRow("触发方式", t?.let { it.expr + tz } ?: "还没上报", end = {
            when {
                run == null -> Unit
                run.late -> SoftTag("未按时运行", c.danger)
                else -> SoftTag("正常", c.success)
            }
        })
        val next = when {
            run == null -> "无法推算"
            !run.parsed -> "无法推算 (${t?.expr})"
            else -> run.next?.let { "${CLOCK.format(Date(it))} (${until(it, now)}) · 今天还有 ${leftToday(run.upcoming, now)} 次" } ?: "无法推算"
        }
        HomeRow("下次触发", next, divider = true)
        if (run?.late == true) run.expected?.let { HomeRow("应在", "${CLOCK.format(Date(it))} 触发, 还没运行", divider = true) }
        val pending = rememberPending(group, a, now)
        HomeRow("上次运行", clock(a.lastRun, now) + (pending?.let { " · 待处理 $it" } ?: ""), divider = true)
    }
}

@Composable
fun AgentVersionSection(group: String, a: ChatAgent, now: Long, setAuto: (Boolean) -> Unit) {
    val c = Aioa.colors
    val pal = hxPalette()
    val context = LocalContext.current
    val s = rememberSkill(a, now)
    val want = remember(a) { wantOf(a, PluginSkills.get(context, a.plugin)).skills }
    HomeSection("版本") {
        var first = true
        if (isSkillAgent(a)) want.forEach { (id, w) ->
            val have = a.skills?.skills?.get(id)
            val miss = s.missing.firstOrNull { it.id == id }
            val gap = when {
                miss != null -> RELINK
                have == w -> "最新"
                else -> "小更新"
            }
            val sub = when {
                have == null -> "未装 · 应有 $w"
                have == w -> "$have · 已是最新"
                miss != null -> "$have · 应有 $w" + (miss.deadline?.let { " · 兼容到 ${dateText(it)}" } ?: "")
                else -> "$have · 应有 $w (小更新, 下一轮自动装)"
            }
            val m = miss?.takeIf { it.changes.isNotEmpty() }
            HomeRow(id, sub, divider = !first, end = { SoftTag(gap, if (miss != null) c.danger else if (have == w) c.success else pal.chart2) }, extra = if (m == null) null else {
                {
                    m.changes.forEach { ch ->
                        Text("${ch.version}: ${ch.changes}", c.textSecondary, 12, maxLines = 3)
                        if (ch.missing.isNotBlank()) Text("不升级会少: ${ch.missing}", c.danger, 12, maxLines = 3)
                    }
                }
            })
            first = false
        }
        if (s.setupHave != null && s.setupHave != s.setupWant) {
            HomeRow("接入版本", "${s.setupHave} -> ${s.setupWant}", divider = !first, end = { SoftTag(RELINK, c.danger) })
            first = false
        }
        HomeRow("命令行", (a.client ?: a.skills?.client) ?: "还没上报", divider = !first)
        GiToggle("大更新自动执行", a.autoMajor, true, "开启后要重发一次接入语才生效") { setAuto(it) }
    }
}

/** 时间线与最近发的几条 (本地库按来源查), 点一条回群里定位。 */
@Composable
fun AgentRecordSection(model: ChatModel, group: String, a: ChatAgent) {
    val context = LocalContext.current
    val now = System.currentTimeMillis()
    var recent by remember { mutableStateOf<List<ServerFrame.Msg>>(emptyList()) }
    LaunchedEffect(a.sourceId) {
        val sid = a.sourceId ?: return@LaunchedEffect
        recent = withContext(Dispatchers.IO) { MessageDb.get(context).bySource(sid, RECENT) }
    }
    HomeSection("记录") {
        HomeRow("接入", trail = clock(a.created, now))
        a.rotated?.let { HomeRow("重新接入", trail = clock(it, now), divider = true) }
        HomeRow("报到", trail = clock(a.joined, now), divider = true)
        HomeRow("最近活跃", trail = clock(a.active, now), divider = true)
        recent.forEach { m ->
            HomeRow(plainPreview(m.text), trail = CLOCK.format(Date(m.ts)), divider = true, onClick = {
                model.groups.page = ChatPage.CHAT
                model.groups.openAt(group, m.seq)
            })
        }
    }
}
