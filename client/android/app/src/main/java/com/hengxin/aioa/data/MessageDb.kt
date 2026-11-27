package com.hengxin.aioa.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import com.hengxin.aioa.Constants
import com.hengxin.aioa.proto.FwdInfo
import com.hengxin.aioa.proto.Mentions
import com.hengxin.aioa.proto.MsgRef
import com.hengxin.aioa.proto.ServerFrame
import org.json.JSONObject

/** 群: 推送方写的 channel; 没写时按来源名, 自己发的归 "备忘"。 */
fun ServerFrame.Msg.groupKey(): String = group ?: if (mine) MessageDb.MEMO_GROUP else src

/** n 是否替代了这条: 同 id 的新版本, 或墓碑指向它的旧序号。 */
fun ServerFrame.Msg.replacedBy(n: ServerFrame.Msg): Boolean =
    seq != n.seq && ((n.id != null && id == n.id) || (n.deletedSeq > 0 && seq == n.deletedSeq))

/** 群列表的一行: 最后一条消息与未读数。 */
/** 本机消息库的累计 (#140), perDay 按设备时区分天。 */
data class Lifetime(val total: Int, val agent: Int, val groups: Int, val first: Long, val perDay: Map<String, Int>)

data class GroupSummary(val key: String, val last: ServerFrame.Msg, val unread: Int, val atMe: Boolean = false)

// 两个进程共用的本地消息库: :link 收到即落库, 界面打开时先读库, 再只向服务端补拉增量
class MessageDb private constructor(context: Context) :
    SQLiteOpenHelper(context, DB_NAME, null, DB_VERSION) {

    init {
        setWriteAheadLoggingEnabled(true)
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE $T_MSG (seq INTEGER PRIMARY KEY, ts INTEGER NOT NULL, src TEXT NOT NULL, text TEXT NOT NULL, cid TEXT, $C_GRP TEXT, $C_EXTRA TEXT, $C_ID TEXT, $C_MINE INTEGER NOT NULL DEFAULT 0, $C_SID TEXT, $C_SEEN INTEGER NOT NULL DEFAULT 0)")
        db.execSQL("CREATE TABLE $T_KV (k TEXT PRIMARY KEY, v INTEGER NOT NULL)")
        db.execSQL(GRP_INDEX)
        db.execSQL(ID_INDEX)
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion < 2) {
            db.execSQL("ALTER TABLE $T_MSG ADD COLUMN $C_GRP TEXT")
            db.execSQL("UPDATE $T_MSG SET $C_GRP = $GROUP_EXPR")
            db.execSQL(GRP_INDEX)
        }
        if (oldVersion < 3) db.execSQL("ALTER TABLE $T_MSG ADD COLUMN $C_EXTRA TEXT")
        if (oldVersion < 4) {
            db.execSQL("ALTER TABLE $T_MSG ADD COLUMN $C_ID TEXT")
            db.execSQL(ID_INDEX)
        }
        if (oldVersion < 5) {
            // 以前靠 src 里的设备前缀认 "自己发的", 现在单独一列; 旧行按前缀回填
            db.execSQL("ALTER TABLE $T_MSG ADD COLUMN $C_MINE INTEGER NOT NULL DEFAULT 0")
            db.execSQL("ALTER TABLE $T_MSG ADD COLUMN $C_SID TEXT")
            db.execSQL("UPDATE $T_MSG SET $C_MINE = 1 WHERE $C_SRC LIKE '${Constants.DEVICE_PREFIX}%'")
        }
        // 在总览里看过的单条消息: 不动群的已读位置, 只是不再算未读
        if (oldVersion < 6) db.execSQL("ALTER TABLE $T_MSG ADD COLUMN $C_SEEN INTEGER NOT NULL DEFAULT 0")
    }

    /** 入库: 同 id 的旧版本和墓碑指向的旧序号先删掉; 删除墓碑本身不留行, 撤回墓碑留一行显示 "已撤回"。 */
    fun insert(msg: ServerFrame.Msg): Boolean {
        if (isHidden(msg.seq)) return false
        val db = writableDatabase
        db.beginTransaction()
        try {
            msg.id?.let { db.delete(T_MSG, "$C_ID = ? AND $C_SEQ != ?", arrayOf(it, msg.seq.toString())) }
            if (msg.deletedSeq > 0) db.delete(T_MSG, "$C_SEQ = ?", arrayOf(msg.deletedSeq.toString()))
            val fresh = msg.deleted != DELETE_MODE && db.insertWithOnConflict(T_MSG, null, valuesOf(msg), SQLiteDatabase.CONFLICT_IGNORE) != -1L
            db.setTransactionSuccessful()
            return fresh
        } finally {
            db.endTransaction()
        }
    }

    /** 未读区间里有没有 @我 或 @所有人 的 (#139): 不只看最后一条, 被 @ 之后又来消息也还提示。 */
    private fun atMeSince(key: String, uid: String?): Boolean =
        readableDatabase.rawQuery(
            "SELECT $C_EXTRA FROM $T_MSG WHERE $C_GRP = ? AND $C_SEQ > ? AND $C_MINE = 0 AND $C_SEEN = 0 AND $LIVE AND $C_EXTRA LIKE '%\"$X_MENTIONS\"%'",
            arrayOf(key, groupRead(key).toString()),
        ).use { c ->
            while (c.moveToNext()) {
                val a = runCatching { JSONObject(c.getString(0)).optJSONArray(X_MENTIONS) }.getOrNull() ?: continue
                if (Mentions.hits((0 until a.length()).map { a.optString(it) }, uid)) return@use true
            }
            false
        }

    /** 只删本机 (#139): 删掉这一行并记下序号, 之后同步或向云端翻页拉回来也不再入库。 */
    fun hideLocal(seq: Long) {
        writableDatabase.delete(T_MSG, "$C_SEQ = ?", arrayOf(seq.toString()))
        putKv(K_HIDDEN + seq, 1)
    }

    fun isHidden(seq: Long): Boolean = seq > 0 && getKv(K_HIDDEN + seq) == 1L

    /** 断线太久: floor 之前的缓存可能漏了删除, 丢掉, 需要时再向云端翻页。 */
    fun dropBefore(floor: Long): Int = writableDatabase.delete(T_MSG, "$C_SEQ < ?", arrayOf(floor.toString()))

    private fun valuesOf(msg: ServerFrame.Msg): ContentValues {
        return ContentValues().apply {
            put(C_SEQ, msg.seq)
            put(C_TS, msg.ts)
            put(C_SRC, msg.src)
            put(C_TEXT, msg.text)
            put(C_CID, msg.cid)
            put(C_GRP, msg.groupKey())
            put(C_EXTRA, extraOf(msg))
            put(C_ID, msg.id)
            put(C_MINE, if (msg.mine) 1 else 0)
            put(C_SID, msg.sid)
        }
    }

    fun maxSeq(): Long = longQuery("SELECT IFNULL(MAX($C_SEQ), 0) FROM $T_MSG")

    fun recent(limit: Int): List<ServerFrame.Msg> = query(
        "SELECT * FROM (SELECT * FROM $T_MSG ORDER BY $C_SEQ DESC LIMIT ?) ORDER BY $C_SEQ",
        arrayOf(limit.toString()),
    )

    /** 某个群里 before 之前的最近 limit 条, 按序号升序; 向上翻页时 before 取当前最早一条。 */
    fun inGroup(key: String, limit: Int, before: Long = Long.MAX_VALUE): List<ServerFrame.Msg> = query(
        "SELECT * FROM (SELECT * FROM $T_MSG WHERE $C_GRP = ? AND $C_SEQ < ? ORDER BY $C_SEQ DESC LIMIT ?) ORDER BY $C_SEQ",
        arrayOf(key, before.toString(), limit.toString()),
    )

    /** 某个来源 (Agent) 最近发的几条, 新的在前。 */
    fun bySource(sid: String, limit: Int): List<ServerFrame.Msg> =
        query("SELECT * FROM $T_MSG WHERE $C_SID = ? AND $LIVE ORDER BY $C_SEQ DESC LIMIT ?", arrayOf(sid, limit.toString()))

    /** 群里 seq > after 且不在 skip 里的人发消息 (自己或 user: 来源) 条数: skill 版 Agent 的待处理。 */
    fun humanAfter(key: String, after: Long, skip: Collection<Long>): Int {
        val not = if (skip.isEmpty()) "" else " AND $C_SEQ NOT IN (${skip.joinToString(",")})"
        return longQuery(
            "SELECT COUNT(*) FROM $T_MSG WHERE $C_GRP = ? AND $C_SEQ > ? AND ($C_MINE = 1 OR $C_SID LIKE 'user:%') AND $LIVE$not",
            arrayOf(key, after.toString()),
        ).toInt()
    }

    /** 今日脉搏: since 起每小时的消息数, 以及其中来源在 agentSids 里的条数; 只读本地, 总览图表用。撤回的不算 (#139)。 */
    fun hourly(since: Long, hours: Int, agentSids: Set<String>): Pair<IntArray, IntArray> {
        val all = IntArray(hours)
        val agent = IntArray(hours)
        readableDatabase.rawQuery("SELECT $C_TS, $C_SID FROM $T_MSG WHERE $C_TS >= ? AND $LIVE", arrayOf(since.toString())).use { c ->
            while (c.moveToNext()) {
                val i = ((c.getLong(0) - since) / HOUR_MS).toInt()
                if (i !in 0 until hours) continue
                all[i]++
                if (!c.isNull(1) && c.getString(1) in agentSids) agent[i]++
            }
        }
        return all to agent
    }

    /**
     * 总览成就 (#140): 本机消息库里一共多少条, Agent 说了多少, 涉及几个群, 最早一条的时间,
     * 以及最近 days 天每天的条数 (按设备时区分天, key 为 yyyy-MM-dd)。撤回的不算。
     */
    fun lifetime(agentSids: Set<String>, days: Int): Lifetime {
        val since = System.currentTimeMillis() - days * DAY_MS
        val ag = if (agentSids.isEmpty()) "0" else "SUM(CASE WHEN $C_SID IN (${agentSids.joinToString(",") { "?" }}) THEN 1 ELSE 0 END)"
        val head = readableDatabase.rawQuery(
            "SELECT COUNT(*), IFNULL($ag, 0), COUNT(DISTINCT $C_GRP), IFNULL(MIN($C_TS), 0) FROM $T_MSG WHERE $LIVE",
            agentSids.toTypedArray(),
        ).use { if (it.moveToFirst()) listOf(it.getLong(0), it.getLong(1), it.getLong(2), it.getLong(3)) else listOf(0L, 0L, 0L, 0L) }
        val perDay = LinkedHashMap<String, Int>()
        readableDatabase.rawQuery(
            "SELECT strftime('%Y-%m-%d', $C_TS / 1000, 'unixepoch', 'localtime') d, COUNT(*) FROM $T_MSG WHERE $C_TS >= ? AND $LIVE GROUP BY d ORDER BY d",
            arrayOf(since.toString()),
        ).use { c -> while (c.moveToNext()) perDay[c.getString(0)] = c.getInt(1) }
        return Lifetime(head[0].toInt(), head[1].toInt(), head[2].toInt(), head[3], perDay)
    }

    /** 周报 (#140): [from, to) 之间没撤回的消息, 只取统计要用的字段, 交给 MessageWeekMath 汇总。 */
    fun weekRows(from: Long, to: Long): List<WeekRow> {
        val out = ArrayList<WeekRow>()
        readableDatabase.rawQuery(
            "SELECT $C_TS, $C_MINE, $C_SID, $C_SRC, $C_GRP, $C_SEQ, $C_SEEN FROM $T_MSG WHERE $C_TS >= ? AND $C_TS < ? AND $LIVE",
            arrayOf(from.toString(), to.toString()),
        ).use { c ->
            while (c.moveToNext()) {
                out += WeekRow(
                    ts = c.getLong(0),
                    mine = c.getInt(1) != 0,
                    sid = if (c.isNull(2)) null else c.getString(2),
                    src = c.getString(3),
                    grp = if (c.isNull(4)) "" else c.getString(4),
                    seq = c.getLong(5),
                    seen = c.getInt(6) != 0,
                )
            }
        }
        return out
    }

    /** 按 seq 批量取 (合并转发详情先用本地有的)。 */
    fun bySeqs(seqs: Collection<Long>): List<ServerFrame.Msg> =
        if (seqs.isEmpty()) emptyList() else query("SELECT * FROM $T_MSG WHERE $C_SEQ IN (${seqs.joinToString(",")}) ORDER BY $C_SEQ", emptyArray())

    /** 某个来源在群里的最近发言时间与条数 (资料卡用, 只算本地)。 */
    fun spoke(key: String, sid: String): Pair<Long, Int> =
        readableDatabase.rawQuery("SELECT IFNULL(MAX($C_TS), 0), COUNT(*) FROM $T_MSG WHERE $C_GRP = ? AND $C_SID = ? AND $LIVE", arrayOf(key, sid))
            .use { if (it.moveToFirst()) it.getLong(0) to it.getInt(1) else 0L to 0 }

    fun find(seq: Long): ServerFrame.Msg? = query("SELECT * FROM $T_MSG WHERE $C_SEQ = ?", arrayOf(seq.toString())).firstOrNull()

    /** 每个群最后一条消息, 按时间倒序; 未读按该群自己的已读位置算, 不含本机发出的。 */
    fun groups(uid: String? = null): List<GroupSummary> {
        val lasts = query(
            "SELECT m.* FROM $T_MSG m JOIN (SELECT MAX($C_SEQ) s FROM $T_MSG GROUP BY $C_GRP) t ON m.$C_SEQ = t.s ORDER BY m.$C_SEQ DESC",
            emptyArray(),
        )
        return lasts.map { m ->
            val key = m.groupKey()
            val unread = longQuery(
                "SELECT COUNT(*) FROM $T_MSG WHERE $C_GRP = ? AND $C_SEQ > ? AND $C_MINE = 0 AND $C_SEEN = 0 AND $LIVE",
                arrayOf(key, groupRead(key).toString()),
            )
            GroupSummary(key, m, unread.toInt(), unread > 0 && atMeSince(key, uid))
        }
    }

    /** 清空一个群 seq <= upTo 的消息, 返回删掉的条数。 */
    fun clearGroup(key: String, upTo: Long): Int =
        writableDatabase.delete(T_MSG, "$C_GRP = ? AND $C_SEQ <= ?", arrayOf(key, upTo.toString()))

    fun groupRead(key: String): Long = getKv(K_GROUP_READ + key)

    fun markGroupRead(key: String, seq: Long) {
        if (seq > groupRead(key)) putKv(K_GROUP_READ + key, seq)
    }

    // 未读: 序号大于已读位置, 且不是自己发的
    fun unread(limit: Int): List<ServerFrame.Msg> = query(
        "SELECT * FROM (SELECT * FROM $T_MSG WHERE $C_SEQ > ? AND $C_MINE = 0 AND $C_SEEN = 0 AND $LIVE ORDER BY $C_SEQ DESC LIMIT ?) ORDER BY $C_SEQ",
        arrayOf(readSeq().toString(), limit.toString()),
    )

    fun unreadCount(): Long = longQuery(
        "SELECT COUNT(*) FROM $T_MSG WHERE $C_SEQ > ? AND $C_MINE = 0 AND $C_SEEN = 0 AND $LIVE",
        arrayOf(readSeq().toString()),
    )

    fun readSeq(): Long = getKv(K_READ_SEQ)

    /** 总览里看过的消息逐条标已读; 返回这些消息所在的群, 供上层判断整群是否已读完。 */
    fun markSeen(seqs: Collection<Long>): Set<String> {
        if (seqs.isEmpty()) return emptySet()
        val marks = seqs.joinToString(",") { "?" }
        val args = seqs.map { it.toString() }.toTypedArray()
        writableDatabase.execSQL("UPDATE $T_MSG SET $C_SEEN = 1 WHERE $C_SEQ IN ($marks)", args)
        return readableDatabase.rawQuery("SELECT DISTINCT $C_GRP FROM $T_MSG WHERE $C_SEQ IN ($marks)", args).use { c ->
            buildSet { while (c.moveToNext()) c.getString(0)?.let(::add) }
        }
    }

    /** 群里还没读的条数与最后一条的序号, 用于总览标完已读后推进整群的已读位置。 */
    fun groupState(key: String): Pair<Int, Long> {
        val unread = longQuery(
            "SELECT COUNT(*) FROM $T_MSG WHERE $C_GRP = ? AND $C_SEQ > ? AND $C_MINE = 0 AND $C_SEEN = 0 AND $LIVE",
            arrayOf(key, groupRead(key).toString()),
        )
        return unread.toInt() to longQuery("SELECT IFNULL(MAX($C_SEQ), 0) FROM $T_MSG WHERE $C_GRP = ?", arrayOf(key))
    }

    fun markRead(seq: Long) {
        if (seq > readSeq()) putKv(K_READ_SEQ, seq)
    }

    private fun getKv(key: String): Long = longQuery("SELECT IFNULL((SELECT v FROM $T_KV WHERE k = ?), 0)", arrayOf(key))

    private fun putKv(key: String, value: Long) {
        writableDatabase.execSQL("INSERT OR REPLACE INTO $T_KV (k, v) VALUES (?, ?)", arrayOf<Any>(key, value))
    }

    private fun longQuery(sql: String, args: Array<String>? = null): Long =
        readableDatabase.rawQuery(sql, args).use { if (it.moveToFirst()) it.getLong(0) else 0L }

    private fun query(sql: String, args: Array<String>): List<ServerFrame.Msg> =
        readableDatabase.rawQuery(sql, args).use { c ->
            val seq = c.getColumnIndexOrThrow(C_SEQ)
            val ts = c.getColumnIndexOrThrow(C_TS)
            val src = c.getColumnIndexOrThrow(C_SRC)
            val text = c.getColumnIndexOrThrow(C_TEXT)
            val cid = c.getColumnIndexOrThrow(C_CID)
            val grp = c.getColumnIndexOrThrow(C_GRP)
            val extra = c.getColumnIndexOrThrow(C_EXTRA)
            val id = c.getColumnIndexOrThrow(C_ID)
            val mine = c.getColumnIndexOrThrow(C_MINE)
            val sid = c.getColumnIndexOrThrow(C_SID)
            buildList {
                while (c.moveToNext()) {
                    val isMine = c.getInt(mine) == 1
                    val rawSrc = c.getString(src)
                    // 旧行里自己的消息存的是设备 id, 显示成自己的名字
                    val srcV = if (isMine && rawSrc.startsWith(Constants.DEVICE_PREFIX)) Me.label else rawSrc
                    // 库里存的是群键; 只有推送方写了 channel 的才还原成 group
                    val g = c.getString(grp)?.takeIf { it != rawSrc && it != MEMO_GROUP }
                    val x = c.getString(extra)?.let { runCatching { JSONObject(it) }.getOrNull() }
                    val reply = x?.optJSONObject(X_REPLY)?.let { MsgRef(it.optLong(C_SEQ), it.optString(C_SRC), it.optString(C_TEXT)) }
                    val fwd = x?.optJSONObject(X_FWD)?.let { FwdInfo(it.optString(C_SRC), it.optLong(C_TS)) }
                    val html = x?.optString(X_HTML)?.ifEmpty { null }
                    val del = x?.optString(X_DELETED)?.ifEmpty { null }
                    val file = com.hengxin.aioa.proto.FileRef.parse(x?.optJSONObject(X_FILE))
                    val feed = x?.optJSONObject(X_FEED)?.toString()
                    val mentions = x?.optJSONArray(X_MENTIONS)?.let { a -> (0 until a.length()).map { a.optString(it) } }.orEmpty()
                    val bundle = com.hengxin.aioa.proto.Bundle.parse(x?.optJSONObject(X_BUNDLE))
                    add(ServerFrame.Msg(c.getLong(seq), c.getLong(ts), srcV, c.getString(text), c.getString(cid), g, reply, fwd, html, c.getString(id), del, file = file, mine = isMine, sid = c.getString(sid), feed = feed, mentions = mentions, bundle = bundle))
                }
            }
        }

    companion object {
        const val MEMO_GROUP = "备忘"
        private const val HOUR_MS = 3_600_000L
        private const val DAY_MS = 86_400_000L
        private const val DB_NAME = "messages.db"
        private const val DB_VERSION = 6
        const val DELETE_MODE = "delete"
        const val RECALL_MODE = "recall"
        /** 只删本机, 不发服务端 (#139)。 */
        const val LOCAL_MODE = "local"
        private const val C_ID = "id"
        private const val X_DELETED = "deleted"
        // 撤回留下的墓碑不算未读, 也不进通知
        private const val LIVE = "(extra IS NULL OR extra NOT LIKE '%\"deleted\":\"recall\"%')"
        private const val ID_INDEX = "CREATE INDEX IF NOT EXISTS msg_id ON msg (id)"
        private const val C_EXTRA = "extra"
        private const val X_REPLY = "reply"
        private const val X_FWD = "fwd"
        private const val X_HTML = "html"
        private const val X_FILE = "file"
        private const val X_FEED = "feed"
        private const val X_MENTIONS = "mentions"
        private const val X_BUNDLE = "bundle"

        // 引用与转发的快照存成一列 JSON, 没有就是 null
        private fun extraOf(m: ServerFrame.Msg): String? {
            if (m.reply == null && m.fwd == null && m.html == null && m.deleted == null && m.file == null && m.feed == null && m.mentions.isEmpty() && m.bundle == null) return null
            val o = JSONObject()
            m.reply?.let { o.put(X_REPLY, JSONObject().put(C_SEQ, it.seq).put(C_SRC, it.src).put(C_TEXT, it.text)) }
            m.fwd?.let { o.put(X_FWD, JSONObject().put(C_SRC, it.src).put(C_TS, it.ts)) }
            m.html?.let { o.put(X_HTML, it) }
            m.file?.let { o.put(X_FILE, it.toJson()) }
            m.feed?.let { runCatching { o.put(X_FEED, JSONObject(it)) } }
            m.deleted?.let { o.put(X_DELETED, it) }
            if (m.mentions.isNotEmpty()) o.put(X_MENTIONS, org.json.JSONArray(m.mentions))
            m.bundle?.let { o.put(X_BUNDLE, it.toJson()) }
            return o.toString()
        }
        private const val T_MSG = "msg"
        private const val T_KV = "kv"
        private const val C_SEQ = "seq"
        private const val C_TS = "ts"
        private const val C_SRC = "src"
        private const val C_TEXT = "text"
        private const val C_CID = "cid"
        private const val C_GRP = "grp"
        private const val C_MINE = "mine"
        private const val C_SID = "sid"
        private const val C_SEEN = "seen"
        private const val K_READ_SEQ = "read_seq"
        private const val K_GROUP_READ = "read:"
        private const val K_HIDDEN = "hide:"
        private const val GRP_INDEX = "CREATE INDEX IF NOT EXISTS msg_grp ON $T_MSG ($C_GRP, $C_SEQ)"
        // 升级时给旧消息补群键, 规则与 groupKey() 一致
        private val GROUP_EXPR = "CASE WHEN $C_SRC LIKE '${Constants.DEVICE_PREFIX}%' THEN '$MEMO_GROUP' ELSE $C_SRC END"

        @Volatile
        private var instance: MessageDb? = null

        fun get(context: Context): MessageDb =
            instance ?: synchronized(this) {
                instance ?: MessageDb(context.applicationContext).also { instance = it }
            }
    }
}
