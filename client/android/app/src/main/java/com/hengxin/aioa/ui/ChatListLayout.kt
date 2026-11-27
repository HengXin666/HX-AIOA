package com.hengxin.aioa.ui

/** 消息列表 v2 的一项: 会话, 域 (一组群), 置顶折叠条。 */
sealed interface ListEntry {
    val key: String

    data class Conv(val row: GroupRowData, val pinned: Boolean) : ListEntry {
        override val key get() = "g:${row.key}"
    }

    data class Domain(val name: String, val rows: List<GroupRowData>) : ListEntry {
        override val key get() = "d:$name"
        val unread get() = rows.sumOf { if (it.muted) 0 else it.unread }
        val latest get() = rows.maxByOrNull { it.order }
        val order get() = latest?.order ?: 0L
    }

    data class Fold(val hidden: Int, val open: Boolean) : ListEntry {
        override val key get() = "fold"
    }
}

/** 算不算 "有未读": 免打扰的群不算 (#139: 筛选与计数同一个口径)。 */
fun countsUnread(r: GroupRowData): Boolean = r.unread > 0 && !r.muted

/** "未读" 筛选旁的数字。 */
fun unreadCount(rows: List<GroupRowData>): Int = rows.sumOf { if (countsUnread(it)) it.unread else 0 }

/** 列表里的筛选: 标签 (只留这些 channel) 或只看未读; 都为空时是 "全部"。 */
data class ListFilter(val channels: Set<String>? = null, val unread: Boolean = false) {
    val active get() = channels != null || unread

    fun keep(r: GroupRowData): Boolean = (channels == null || r.key in channels) && (!unread || countsUnread(r))
}

const val PINS_SHOWN = 3

/**
 * 排列: 置顶在上 (超过 3 个折叠), 其余会话与域按最近时间混排; 一个群只在一个域里。
 * 域里置顶的群只在置顶区出现一次, 域这一行不再算它 (#139); 点进域仍能看到 (domainRows)。
 * 有筛选时不分域, 命中的会话直接列出, 方便一眼看全。
 */
fun layoutList(rows: List<GroupRowData>, folders: List<ChatFolder>, filter: ListFilter, pinsOpen: Boolean): List<ListEntry> {
    val byOrder = compareByDescending<GroupRowData> { it.order }
    if (filter.active) {
        val hit = rows.filter(filter::keep)
        return hit.filter { it.pinned }.sortedWith(byOrder).map { ListEntry.Conv(it, true) } +
            hit.filter { !it.pinned }.sortedWith(byOrder).map { ListEntry.Conv(it, false) }
    }
    val out = ArrayList<ListEntry>()
    val pinned = rows.filter { it.pinned }.sortedWith(byOrder)
    val shown = if (pinsOpen || pinned.size <= PINS_SHOWN) pinned else pinned.take(PINS_SHOWN)
    shown.forEach { out += ListEntry.Conv(it, true) }
    if (pinned.size > PINS_SHOWN) out += ListEntry.Fold(pinned.size - PINS_SHOWN, pinsOpen)
    val byKey = rows.associateBy { it.key }
    val inDomain = folders.flatMap { it.groups }.toSet()
    val domains = folders.map { f -> ListEntry.Domain(f.name, f.groups.mapNotNull { byKey[it] }.filter { !it.pinned }.sortedWith(byOrder)) }
    val loose = rows.filter { !it.pinned && it.key !in inDomain }.map { ListEntry.Conv(it, false) }
    out += (loose + domains).sortedByDescending { e -> if (e is ListEntry.Conv) e.row.order else (e as ListEntry.Domain).order }
    return out
}

/** 点进域看到的全部群: 置顶的在前, 再按最近时间。 */
fun domainRows(rows: List<GroupRowData>, folder: ChatFolder?): List<GroupRowData> {
    val byKey = rows.associateBy { it.key }
    return folder?.groups.orEmpty().mapNotNull { byKey[it] }.sortedWith(compareByDescending<GroupRowData> { it.pinned }.thenByDescending { it.order })
}
