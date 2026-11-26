package com.hengxin.aioa.ui.agents

import android.content.Context
import androidx.compose.runtime.mutableStateMapOf
import com.hengxin.aioa.ui.chat.ChatAgent
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Locale

// skill 版 Agent 的版本与运行状态, 与 protocol/src/v1/agent-skill.ts 一致 (docs/design/agent-skill.md)

const val CORE_SKILL = "hx-aioa"
// 必须和 protocol 的 CORE_SKILL_VERSION 一致
const val CORE_SKILL_VERSION = "1.0"
const val MAJOR_COMPAT_DAYS = 14
private const val DAY_MS = 86_400_000L
private const val DEFAULT_SETUP = 1
private const val KEY_VERSION = "version"
private const val KEY_CHANGES = "changes"
private const val KEY_MISSING = "missing"
private const val KEY_UNTIL = "until"
private const val KEY_SKILL = "skill"
private val VER = Regex("""^(\d+)\.(\d+)$""")
private val DATE = SimpleDateFormat("yyyy-MM-dd", Locale.CHINA)

data class SkillReport(val setup: Int, val skills: Map<String, String>, val auto: Boolean = false)
/** 触发方式: expr 是 Agent 原样上报的定时表达式, every 是服务端推算的间隔秒数, tz 是 Agent 宿主的 IANA 时区。 */
data class AgentTrigger(val expr: String, val every: Long?, val at: Long, val tz: String? = null)
/** 插件清单 agent.changes 的一项: 某个大版本改了什么, 不升级会少什么, 旧版兼容到哪天。 */
data class MajorChange(val version: String, val changes: String, val missing: String, val until: String?)
/** 插件清单里与 skill 有关的两项: agent.skill 与 agent.changes。 */
data class PluginSkill(val skill: String, val changes: List<MajorChange>)

enum class SkillGap { SAME, MINOR, MAJOR }

/** 缺的一个大版本: id 为 skill 名, deadline 为兼容截止 (毫秒)。 */
data class MissingMajor(val id: String, val have: String?, val want: String, val changes: List<MajorChange>, val deadline: Long?)

/** 卡片要的 skill 状态; legacy 表示还没装 skill (旧指令 Agent)。 */
data class SkillStatus(val gap: SkillGap, val legacy: Boolean, val setupHave: Int?, val setupWant: Int, val missing: List<MissingMajor>)

fun parseSkillVer(s: String?): Pair<Int, Int>? = VER.find(s.orEmpty())?.let { it.groupValues[1].toInt() to it.groupValues[2].toInt() }

/** 已装的和应有的差多少: 接入版本或任一大号不同算 MAJOR, 只差小号算 MINOR。 */
fun skillGap(have: SkillReport?, want: SkillReport): SkillGap {
    if (have == null || have.setup != want.setup) return SkillGap.MAJOR
    var gap = SkillGap.SAME
    for ((id, w) in want.skills) {
        val a = parseSkillVer(have.skills[id])
        val b = parseSkillVer(w)
        if (a == null || b == null || a.first != b.first) return SkillGap.MAJOR
        if (a.second != b.second) gap = SkillGap.MINOR
    }
    return gap
}

/** 应有版本: 插件清单不在本地时, 只按服务端记下的 warned 推出插件缺的大号, 不发请求。 */
fun wantOf(a: ChatAgent, plugin: PluginSkill?): SkillReport {
    val skills = linkedMapOf(CORE_SKILL to CORE_SKILL_VERSION)
    a.plugin?.let { id ->
        val v = plugin?.skill?.takeIf { parseSkillVer(it) != null } ?: warnedMajor(a, id)?.let { "$it.0" }
        if (v != null) skills[id] = v
    }
    return SkillReport(a.setup ?: DEFAULT_SETUP, skills, a.autoMajor)
}

// warned 形如 "hengxin666.todo@2:new"; 只取比已装更高的大号
private fun warnedMajor(a: ChatAgent, id: String): Int? {
    val have = parseSkillVer(a.skills?.skills?.get(id))?.first ?: 0
    return a.warned.mapNotNull { w ->
        val head = w.substringBefore(':')
        if (head.substringBeforeLast('@') == id) head.substringAfterLast('@').toIntOrNull() else null
    }.filter { it > have }.maxOrNull()
}

fun skillStatus(context: Context, a: ChatAgent, plugin: PluginSkill?, now: Long): SkillStatus {
    val want = wantOf(a, plugin)
    val have = a.skills
    val gap = skillGap(have, want)
    val missing = if (gap != SkillGap.MAJOR) emptyList() else want.skills.mapNotNull { (id, w) ->
        val hv = have?.skills?.get(id)
        val hm = parseSkillVer(hv)?.first ?: 0
        val wm = parseSkillVer(w)?.first ?: return@mapNotNull null
        if (hv != null && hm == wm) return@mapNotNull null
        val changes = if (id == a.plugin) plugin?.changes.orEmpty().filter { c -> parseSkillVer(c.version)?.first?.let { it in (hm + 1)..wm } == true } else emptyList()
        val seen = SkillSeen.first(context, "${a.keyId}|$id@$wm", now)
        val untils = changes.mapNotNull { c -> c.until?.let { runCatching { DATE.parse(it)?.time }.getOrNull() } }
        MissingMajor(id, hv, w, changes, untils.minOrNull() ?: (seen + MAJOR_COMPAT_DAYS * DAY_MS))
    }
    return SkillStatus(gap, have == null, have?.setup, want.setup, missing)
}

/** 按触发表达式推算 (Trigger.kt); 没上报为 null。 */
fun runInfo(a: ChatAgent, now: Long): TriggerView? = a.trigger?.let { triggerView(it, a.lastRun, now) }

fun dateText(ts: Long): String = DATE.format(java.util.Date(ts))

fun parseSkillReport(o: JSONObject?): SkillReport? {
    o ?: return null
    val s = o.optJSONObject("skills")
    val skills = s?.keys()?.asSequence()?.associateWith { s.optString(it) }.orEmpty()
    return SkillReport(o.optInt("setup"), skills, o.optBoolean("auto"))
}

fun parseTrigger(o: JSONObject?): AgentTrigger? = o?.optString("expr")?.ifEmpty { null }?.let {
    AgentTrigger(it, if (o.has("every")) o.optLong("every") else null, o.optLong("at"), o.optString("tz").ifEmpty { null })
}

fun parseChanges(a: JSONArray?): List<MajorChange> = (0 until (a?.length() ?: 0)).mapNotNull { i ->
    a?.optJSONObject(i)?.let { MajorChange(it.optString(KEY_VERSION), it.optString(KEY_CHANGES), it.optString(KEY_MISSING), it.optString(KEY_UNTIL).ifEmpty { null }) }
}

/** 插件清单里的 skill 版本与大版本说明: 打开插件详情时顺手记下, 卡片只读这里, 不为它发请求。 */
object PluginSkills {
    private const val PREFS = "plugin_skills"
    private val map = mutableStateMapOf<String, PluginSkill>()
    private var loaded = false

    fun get(context: Context, id: String?): PluginSkill? {
        id ?: return null
        if (!loaded) load(context)
        return map[id]
    }

    /** 记下清单的 agent 段; 没有 agent.skill 的插件删掉旧记录。 */
    fun remember(context: Context, id: String, agent: JSONObject?) {
        val skill = agent?.optString(KEY_SKILL)?.ifEmpty { null }
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (skill == null) {
            map.remove(id)
            prefs.edit().remove(id).apply()
            return
        }
        map[id] = PluginSkill(skill, parseChanges(agent.optJSONArray(KEY_CHANGES)))
        prefs.edit().putString(id, JSONObject().put(KEY_SKILL, skill).put(KEY_CHANGES, agent.optJSONArray(KEY_CHANGES) ?: JSONArray()).toString()).apply()
    }

    private fun load(context: Context) {
        loaded = true
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).all.forEach { (id, v) ->
            runCatching { JSONObject(v as String) }.getOrNull()?.let { map[id] = PluginSkill(it.optString(KEY_SKILL), parseChanges(it.optJSONArray(KEY_CHANGES))) }
        }
    }
}

/** 本机第一次看到某个大版本缺失的时间; 清单没写 until 时兼容截止按它加 14 天算。 */
private object SkillSeen {
    private const val PREFS = "agent_skill_seen"

    fun first(context: Context, key: String, now: Long): Long {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val v = prefs.getLong(key, 0L)
        if (v > 0) return v
        prefs.edit().putLong(key, now).apply()
        return now
    }
}
