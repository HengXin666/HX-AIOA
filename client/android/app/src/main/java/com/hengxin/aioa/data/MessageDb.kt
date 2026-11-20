package com.hengxin.aioa.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import com.hengxin.aioa.proto.ServerFrame

// 两个进程共用的本地消息库: :link 收到即落库, 界面打开时先读库, 再只向服务端补拉增量
class MessageDb private constructor(context: Context) :
    SQLiteOpenHelper(context, DB_NAME, null, DB_VERSION) {

    init {
        setWriteAheadLoggingEnabled(true)
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE $T_MSG (seq INTEGER PRIMARY KEY, ts INTEGER NOT NULL, src TEXT NOT NULL, text TEXT NOT NULL, cid TEXT)")
        db.execSQL("CREATE TABLE $T_KV (k TEXT PRIMARY KEY, v INTEGER NOT NULL)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

    fun insert(msg: ServerFrame.Msg): Boolean {
        val values = ContentValues().apply {
            put(C_SEQ, msg.seq)
            put(C_TS, msg.ts)
            put(C_SRC, msg.src)
            put(C_TEXT, msg.text)
            put(C_CID, msg.cid)
        }
        return writableDatabase.insertWithOnConflict(T_MSG, null, values, SQLiteDatabase.CONFLICT_IGNORE) != -1L
    }

    fun maxSeq(): Long = longQuery("SELECT IFNULL(MAX($C_SEQ), 0) FROM $T_MSG")

    fun recent(limit: Int): List<ServerFrame.Msg> = query(
        "SELECT * FROM (SELECT * FROM $T_MSG ORDER BY $C_SEQ DESC LIMIT ?) ORDER BY $C_SEQ",
        arrayOf(limit.toString()),
    )

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
            buildList {
                while (c.moveToNext()) {
                    add(ServerFrame.Msg(c.getLong(seq), c.getLong(ts), c.getString(src), c.getString(text), c.getString(cid)))
                }
            }
        }

    companion object {
        private const val DB_NAME = "messages.db"
        private const val DB_VERSION = 1
        private const val T_MSG = "msg"
        private const val T_KV = "kv"
        private const val C_SEQ = "seq"
        private const val C_TS = "ts"
        private const val C_SRC = "src"
        private const val C_TEXT = "text"
        private const val C_CID = "cid"
        private const val K_READ_SEQ = "read_seq"

        @Volatile
        private var instance: MessageDb? = null

        fun get(context: Context): MessageDb =
            instance ?: synchronized(this) {
                instance ?: MessageDb(context.applicationContext).also { instance = it }
            }
    }
}
