package com.hengxin.aioa.ui

import org.json.JSONArray
import org.json.JSONObject

// GitHub 走势 (#142): 服务端 GET /github/trend 一次给全, 14 天与 12 周都在里面, 切范围不再请求

/** 一格 (一天或一周): 提交, PR 新开 / 合入 / 未合入关闭, Issue 新开 / 关闭完成 / 未完成就关, 我发的 PR / Issue 评论, 评审。 */
data class GhTrendPoint(
    val label: String,
    val commits: Int = 0,
    val prOpened: Int = 0,
    val prMerged: Int = 0,
    val prClosed: Int = 0,
    val issueOpened: Int = 0,
    val issueClosed: Int = 0,
    val prComments: Int = 0,
    val issueComments: Int = 0,
    val reviews: Int = 0,
    val issueDropped: Int = 0,
) {
    val comments get() = prComments + issueComments

    operator fun plus(o: GhTrendPoint) = GhTrendPoint(
        label, commits + o.commits, prOpened + o.prOpened, prMerged + o.prMerged, prClosed + o.prClosed,
        issueOpened + o.issueOpened, issueClosed + o.issueClosed, prComments + o.prComments, issueComments + o.issueComments, reviews + o.reviews,
        issueDropped + o.issueDropped,
    )
}

/** received: 范围内我新开的 Issue / PR 收到的评论总数。 */
data class GhTrendSeries(val points: List<GhTrendPoint>, val received: Int) {
    val total get() = points.fold(GhTrendPoint("")) { a, b -> a + b }
}

/** 足迹: 新建的仓库 (at 为创建时间, fork 带上游 parent) 或 star 的仓库 (at 为 star 时间)。 */
data class GhFootprint(
    val repo: String, val url: String, val at: Long, val description: String?, val private: Boolean, val stars: Int?,
    val fork: Boolean = false, val parent: String? = null,
)

data class GhTrend(
    val login: String,
    val days: GhTrendSeries,
    val weeks: GhTrendSeries,
    val created: List<GhFootprint>,
    val starred: List<GhFootprint>,
    val done: Boolean,
    val syncedAt: Long,
)

private fun objects(a: JSONArray?): List<JSONObject> = (0 until (a?.length() ?: 0)).mapNotNull { a?.optJSONObject(it) }

private fun seriesOf(o: JSONObject?): GhTrendSeries = GhTrendSeries(
    objects(o?.optJSONArray("points")).map {
        GhTrendPoint(
            it.optString("label"), it.optInt("commits"), it.optInt("prOpened"), it.optInt("prMerged"), it.optInt("prClosed"),
            it.optInt("issueOpened"), it.optInt("issueClosed"), it.optInt("prComments"), it.optInt("issueComments"), it.optInt("reviews"),
            it.optInt("issueDropped"),
        )
    },
    o?.optInt("received") ?: 0,
)

private fun footprints(a: JSONArray?): List<GhFootprint> = objects(a).map {
    GhFootprint(
        it.optString("repo"), it.optString("url"), it.optLong("at"), it.optString("description").ifEmpty { null },
        it.optBoolean("private"), if (it.has("stars")) it.optInt("stars") else null,
        it.optBoolean("fork"), it.optString("parent").ifEmpty { null },
    )
}

fun parseTrend(o: JSONObject): GhTrend = GhTrend(
    o.optString("login"),
    seriesOf(o.optJSONObject("days")),
    seriesOf(o.optJSONObject("weeks")),
    footprints(o.optJSONArray("created")),
    footprints(o.optJSONArray("starred")),
    o.optJSONObject("backfill")?.optBoolean("done") ?: false,
    o.optLong("syncedAt"),
)

/** 坐标轴上的日期: "2026-11-23" → "11-23"; 按周时同样取那周周一。 */
fun trendAxis(label: String): String = label.drop(DATE_MONTH_AT).ifEmpty { label }

/** 选中一格的明细一行; 一周时写 "11-23 那周"。 */
fun trendLine(p: GhTrendPoint, weekly: Boolean): String {
    val head = trendAxis(p.label) + if (weekly) " 那周" else ""
    val parts = buildList {
        if (p.commits > 0) add("提交 ${p.commits}")
        if (p.prOpened + p.prMerged + p.prClosed > 0) add("PR 新开 ${p.prOpened} 合入 ${p.prMerged}" + if (p.prClosed > 0) " 关闭 ${p.prClosed}" else "")
        if (p.issueOpened + p.issueClosed + p.issueDropped > 0) add("Issue 新开 ${p.issueOpened} 关闭 ${p.issueClosed}" + if (p.issueDropped > 0) " 未完成关 ${p.issueDropped}" else "")
        if (p.comments > 0) add("评论 ${p.comments}")
        if (p.reviews > 0) add("评审 ${p.reviews}")
    }
    return if (parts.isEmpty()) "$head: 没有动静。" else "$head: " + parts.joinToString(" · ")
}

private const val DATE_MONTH_AT = 5

/** 足迹的时间: 今年写 "11-26", 往年写 "2025-11-26" (设备时区)。 */
fun footDate(at: Long, zone: java.time.ZoneId = java.time.ZoneId.systemDefault(), today: java.time.LocalDate = java.time.LocalDate.now(zone)): String {
    val d = java.time.Instant.ofEpochMilli(at).atZone(zone).toLocalDate()
    return if (d.year == today.year) d.toString().drop(DATE_MONTH_AT) else d.toString()
}
