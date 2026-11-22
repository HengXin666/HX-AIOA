package com.hengxin.aioa.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import com.hengxin.aioa.Constants
import com.hengxin.aioa.proto.ServerFrame

/** 群: 推送方写的 channel; 没写时按来源名, 本机发出的归 "备忘"。 */
fun ServerFrame.Msg.groupKey(): String = group ?: if (src.startsWith(Constants.DEVICE_PREFIX)) MessageDb.MEMO_GROUP else src

/** 群列表的一行: 最后一条消息与未读数。 */
data class GroupSummary(val key: String, val last: ServerFrame.Msg, val unread: Int)

// 两个进程共用的本地消息库: :link 收到即落库, 界面打开时先读库, 再只向服务端补拉增量
class MessageDb private constructor(context: Context) :
    SQLiteOpenHelper(context, DB_NAME, null, DB_VERSION) {

    init {
        setWriteAheadLoggingEnabled(true)
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE $T_MSG (seq INTEGER PRIMARY KEY, ts INTEGER NOT NULL, src TEXT NOT NULL, text TEXT NOT NULL, cid TEXT, $C_GRP TEXT)")
        db.execSQL("CREATE TABLE $T_KV (k TEXT PRIMARY KEY, v INTEGER NOT NULL)")
        db.execSQL(GRP_INDEX)
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion < 2) {
            db.execSQL("ALTER TABLE $T_MSG ADD COLUMN $C_GRP TEXT")
            db.execSQL("UPDATE $T_MSG SET $C_GRP = $GROUP_EXPR")
            db.execSQL(GRP_INDEX)
        }
    }

    fun insert(msg: ServerFrame.Msg): Boolean {
        val values = ContentValues().apply {
            put(C_SEQ, msg.seq)
            put(C_TS, msg.ts)
            put(C_SRC, msg.src)
            put(C_TEXT, msg.text)
            put(C_CID, msg.cid)
            put(C_GRP, msg.groupKey())
        }
        return writableDatabase.insertWithOnConflict(T_MSG, null, values, SQLiteDatabase.CONFLICT_IGNORE) != -1L
    }

    fun maxSeq(): Long = longQuery("SELECT IFNULL(MAX($C_SEQ), 0) FROM $T_MSG")

    fun recent(limit: Int): List<ServerFrame.Msg> = query(
        "SELECT * FROM (SELECT * FROM $T_MSG ORDER BY $C_SEQ DESC LIMIT ?) ORDER BY $C_SEQ",
        arrayOf(limit.toString()),
    )

    fun inGroup(key: String, limit: Int): List<ServerFrame.Msg> = query(
        "SELECT * FROM (SELECT * FROM $T_MSG WHERE $C_GRP = ? ORDER BY $C_SEQ DESC LIMIT ?) ORDER BY $C_SEQ",
        arrayOf(key, limit.toString()),
    )

    /** 每个群最后一条消息, 按时间倒序; 未读按该群自己的已读位置算, 不含本机发出的。 */
    fun groups(): List<GroupSummary> {
        val lasts = query(
            "SELECT m.* FROM $T_MSG m JOIN (SELECT MAX($C_SEQ) s FROM $T_MSG GROUP BY $C_GRP) t ON m.$C_SEQ = t.s ORDER BY m.$C_SEQ DESC",
            emptyArray(),
        )
        return lasts.map { m ->
            val key = m.groupKey()
            val unread = longQuery(
                "SELECT COUNT(*) FROM $T_MSG WHERE $C_GRP = ? AND $C_SEQ > ? AND $C_SRC NOT LIKE ?",
                arrayOf(key, groupRead(key).toString(), "${Constants.DEVICE_PREFIX}%"),
            )
            GroupSummary(key, m, unread.toInt())
        }
    }

    fun groupRead(key: String): Long = getKv(K_GROUP_READ + key)

    fun markGroupRead(key: String, seq: Long) {
        if (seq > groupRead(key)) putKv(K_GROUP_READ + key, seq)
    }

    // 未读: 序号大于已读位置, 且不是本机发出的
    fun unread(selfPrefix: String, limit: Int): List<ServerFrame.Msg> = query(
        "SELECT * FROM (SELECT * FROM $T_MSG WHERE $C_SEQ > ? AND $C_SRC NOT LIKE ? ORDER BY $C_SEQ DESC LIMIT ?) ORDER BY $C_SEQ",
        arrayOf(readSeq().toString(), "$selfPrefix%", limit.toString()),
    )

    fun unreadCount(selfPrefix: String): Long = longQuery(
        "SELECT COUNT(*) FROM $T_MSG WHERE $C_SEQ > ? AND $C_SRC NOT LIKE ?",
        arrayOf(readSeq().toString(), "$selfPrefix%"),
    )

    fun readSeq(): Long = getKv(K_READ_SEQ)

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
            buildList {
                while (c.moveToNext()) {
                    val srcV = c.getString(src)
                    // 库里存的是群键; 只有推送方写了 channel 的才还原成 group
                    val g = c.getString(grp)?.takeIf { it != srcV && it != MEMO_GROUP }
                    add(ServerFrame.Msg(c.getLong(seq), c.getLong(ts), srcV, c.getString(text), c.getString(cid), g))
                }
            }
        }

    companion object {
        const val MEMO_GROUP = "备忘"
        private const val DB_NAME = "messages.db"
        private const val DB_VERSION = 2
        private const val T_MSG = "msg"
        private const val T_KV = "kv"
        private const val C_SEQ = "seq"
        private const val C_TS = "ts"
        private const val C_SRC = "src"
        private const val C_TEXT = "text"
        private const val C_CID = "cid"
        private const val C_GRP = "grp"
        private const val K_READ_SEQ = "read_seq"
        private const val K_GROUP_READ = "read:"
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
