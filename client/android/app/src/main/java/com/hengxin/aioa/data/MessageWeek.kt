package com.hengxin.aioa.data

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.ChronoUnit

/** 周报里的一个交流对象: 来源 id, 显示名, 这周发来几条, 是不是 Agent。 */
data class Peer(val sid: String, val name: String, val count: Int, val agent: Boolean)

/**
 * 一周的消息 (#140 周报), 只算本机消息库, 撤回的不算。
 * perDay[天] = [我发出, Agent 发来, 真人发来]; viewed 是别人发来的里我看过的 (已读位置之内或标了 seen)。
 */
class MessageWeek(
    val mine: Int,
    val agent: Int,
    val human: Int,
    val viewed: Int,
    val groups: Int,
    val perDay: Array<IntArray>,
    val perHour: Array<IntArray>,
    val peers: List<Peer>,
) {
    val total: Int get() = mine + agent + human
}

/** 一行消息里周报用到的字段。 */
data class WeekRow(val ts: Long, val mine: Boolean, val sid: String?, val src: String, val grp: String, val seq: Long, val seen: Boolean)

object MessageWeekMath {
    const val MINE = 0
    const val AGENT = 1
    const val HUMAN = 2

    fun tally(rows: List<WeekRow>, agentSids: Set<String>, readOf: (String) -> Long, first: LocalDate, zone: ZoneId, days: Int = 7, top: Int = 12): MessageWeek {
        val perDay = Array(days) { IntArray(3) }
        val perHour = Array(days) { IntArray(24) }
        val counts = HashMap<String, Int>()
        val names = HashMap<String, String>()
        val reads = HashMap<String, Long>()
        val groups = HashSet<String>()
        var viewed = 0
        for (r in rows) {
            val at = Instant.ofEpochMilli(r.ts).atZone(zone)
            val day = ChronoUnit.DAYS.between(first, at.toLocalDate()).toInt()
            if (day !in 0 until days) continue
            val kind = when {
                r.mine -> MINE
                r.sid != null && r.sid in agentSids -> AGENT
                else -> HUMAN
            }
            perDay[day][kind]++
            perHour[day][at.hour]++
            groups += r.grp
            if (r.mine) continue
            if (r.seen || r.seq <= reads.getOrPut(r.grp) { readOf(r.grp) }) viewed++
            val who = r.sid ?: r.src
            counts[who] = (counts[who] ?: 0) + 1
            names[who] = r.src
        }
        val peers = counts.entries.sortedByDescending { it.value }.take(top)
            .map { Peer(it.key, names[it.key] ?: it.key, it.value, it.key in agentSids) }
        return MessageWeek(
            mine = perDay.sumOf { it[MINE] },
            agent = perDay.sumOf { it[AGENT] },
            human = perDay.sumOf { it[HUMAN] },
            viewed = viewed,
            groups = groups.size,
            perDay = perDay,
            perHour = perHour,
            peers = peers,
        )
    }
}
