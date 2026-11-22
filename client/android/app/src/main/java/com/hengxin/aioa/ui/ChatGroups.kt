package com.hengxin.aioa.ui

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.hengxin.aioa.Constants
import com.hengxin.aioa.data.GroupSummary
import com.hengxin.aioa.data.MessageDb
import com.hengxin.aioa.data.groupKey
import com.hengxin.aioa.net.Api
import com.hengxin.aioa.proto.Frames
import com.hengxin.aioa.proto.MsgRef
import com.hengxin.aioa.proto.ServerFrame
import com.hengxin.aioa.ui.chat.ChatDirectory
import com.hengxin.aioa.ui.chat.ChatMeta
import com.hengxin.aioa.ui.chat.plainPreview
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/** 组: 把几个群收在一起, 只影响显示。 */
data class ChatFolder(val name: String, val groups: List<String>)

/** 群列表的一行: 有消息的群与只建了资料还没消息的群合在一起。 */
data class GroupRowData(val key: String, val meta: ChatMeta?, val last: ServerFrame.Msg?, val unread: Int) {
    val pinned get() = meta?.pinned == true
    val muted get() = meta?.muted == true
    val order get() = last?.ts ?: meta?.updated ?: 0L
}

/** 还没被服务端确认的消息, 先显示在本地 (乐观上屏)。 */
data class Pending(val cid: String, val text: String, val ts: Long, val reply: MsgRef?, val failed: Boolean = false)

/** 消息栏当前在看什么。 */
enum class ChatPage { CHAT, SETTINGS }

// 群来自消息自带的 channel (推送方决定), 组由用户在客户端整理, 存进账号设置多端同步
class ChatGroups(
    private val context: Context,
    private val scope: CoroutineScope,
    private val db: MessageDb,
    private val socketSend: (String) -> Boolean,
) {
    val directory = ChatDirectory(context, scope)
    var summaries by mutableStateOf<List<GroupSummary>>(emptyList())
        private set
    var folders by mutableStateOf<List<ChatFolder>>(emptyList())
        private set
    var open by mutableStateOf<String?>(null)
        private set
    var page by mutableStateOf(ChatPage.CHAT)
    var favoritesOpen by mutableStateOf(false)
    val messages = mutableStateListOf<ServerFrame.Msg>()
    val pending = mutableStateListOf<Pending>()
    var replyTo by mutableStateOf<ServerFrame.Msg?>(null)
    var hasMore by mutableStateOf(false)
        private set
    var jump by mutableStateOf<Long?>(null)
    var error by mutableStateOf<String?>(null)
        private set
    var syncing by mutableStateOf(false)
        private set
    private var loadingOlder = false
    /** 某个群被清空到 seq 时通知外层 (总览的今日消息等内存列表一起删)。 */
    var onCleared: ((String, Long) -> Unit)? = null

    /** 下拉同步: 群资料, 收藏, 分组都重新拉一次。 */
    fun syncNow() {
        if (syncing) return
        syncing = true
        scope.launch {
            val folders = loadFolders()
            directory.syncNow()
            folders.join()
            reload()
            syncing = false
        }
    }

    fun rows(): List<GroupRowData> {
        val metas = directory.metas
        val fromDb = summaries.map { GroupRowData(it.key, metas[it.key], it.last, it.unread) }
        val known = fromDb.map { it.key }.toSet()
        // 没消息的群只在建过资料时显示; 只剩已读 / 清空位置的 (比如清空过的测试群) 不占列表
        val empty = metas.values.filter { it.channel !in known && it.configured }.map { GroupRowData(it.channel, it, null, 0) }
        return (fromDb + empty).sortedWith(compareByDescending<GroupRowData> { it.pinned }.thenByDescending { it.order })
    }

    fun reload() {
        scope.launch { summaries = withContext(Dispatchers.IO) { db.groups() } }
    }

    fun loadFolders() = scope.launch(Dispatchers.IO) {
        val r = Api.call(context, GET, listOf(Constants.SETTINGS_PATH))
        withContext(Dispatchers.Main) { r.body?.optJSONObject("settings")?.let(::applySettings) }
    }

    /** 设置变化 (本机或其它设备改了组) 时直接套用。 */
    fun applySettings(settings: JSONObject) {
        val arr = settings.optJSONArray(Constants.SETTING_CHAT_FOLDERS) ?: JSONArray()
        folders = (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }.map { o ->
            val g = o.optJSONArray("groups")
            ChatFolder(o.optString("name"), (0 until (g?.length() ?: 0)).map { g!!.optString(it) })
        }.filter { it.name.isNotEmpty() }
    }

    /** 群资料变了: 其它设备读过的群本机也算已读, 被清空的群删掉本地记录。 */
    fun applyReads() {
        val metas = directory.metas.values.filter { it.read > 0 || it.cleared > 0 }
        if (metas.isEmpty()) return
        scope.launch {
            withContext(Dispatchers.IO) {
                metas.forEach { m ->
                    if (m.read > 0) db.markGroupRead(m.channel, m.read)
                    if (m.cleared > 0) db.clearGroup(m.channel, m.cleared)
                }
            }
            metas.filter { it.cleared > 0 }.forEach { m -> onCleared?.invoke(m.channel, m.cleared) }
            metas.firstOrNull { it.channel == open && it.cleared > 0 }?.let { m -> messages.removeAll { it.seq <= m.cleared } }
            reload()
        }
    }

    /** 清空聊天记录: 服务端存档一起删, 其它设备收到 chat_sync 后也会删。 */
    fun clearHistory(key: String, done: (String?) -> Unit) {
        scope.launch {
            val r = withContext(Dispatchers.IO) { directory.clear(key) }
            val upTo = r.getOrDefault(0L)
            if (upTo > 0) {
                withContext(Dispatchers.IO) { db.clearGroup(key, upTo) }
                if (open == key) messages.removeAll { it.seq <= upTo }
                onCleared?.invoke(key, upTo)
                reload()
                directory.refreshChats()
            }
            done(r.exceptionOrNull()?.message)
        }
    }

    fun folderOf(group: String): String? = folders.firstOrNull { group in it.groups }?.name

    /** 把群移到某个组; folder 为空表示移出所有组。 */
    fun moveTo(group: String, folder: String?) = save(folders.map { f ->
        val rest = f.groups - group
        if (f.name == folder) f.copy(groups = rest + group) else f.copy(groups = rest)
    })

    fun addFolder(name: String): Boolean {
        val n = name.trim()
        if (n.isEmpty() || folders.any { it.name == n }) return false
        save(folders + ChatFolder(n, emptyList()))
        return true
    }

    /** 删组不删群, 群回到未分组。 */
    fun removeFolder(name: String) = save(folders.filter { it.name != name })

    fun openGroup(key: String) {
        if (open == key) return
        open = key
        page = ChatPage.CHAT
        replyTo = null
        messages.clear()
        pending.clear()
        hasMore = false
        scope.launch {
            val list = withContext(Dispatchers.IO) { db.inGroup(key, Constants.HISTORY_PAGE) }
            if (open != key) return@launch
            // 读库期间可能已有新消息追加进来, 合并去重
            val merged = (list + messages).distinctBy { it.seq }.sortedBy { it.seq }
            messages.clear()
            messages.addAll(merged)
            hasMore = list.size >= Constants.HISTORY_PAGE
            list.lastOrNull()?.let { markRead(key, it.seq) }
        }
    }

    /** 上滑到顶时向前翻一页。 */
    fun loadOlder() {
        val key = open ?: return
        val first = messages.firstOrNull()?.seq ?: return
        if (loadingOlder || !hasMore) return
        loadingOlder = true
        scope.launch {
            val list = withContext(Dispatchers.IO) { db.inGroup(key, Constants.HISTORY_PAGE, first) }
            if (open == key) {
                messages.addAll(0, list.filter { m -> messages.none { it.seq == m.seq } })
                hasMore = list.size >= Constants.HISTORY_PAGE
            }
            loadingOlder = false
        }
    }

    /** 点引用跳到原消息: 不在当前页就往前翻, 最多翻几页。 */
    fun jumpTo(seq: Long) {
        scope.launch {
            var tries = 0
            while (messages.none { it.seq == seq } && hasMore && tries < MAX_JUMP_PAGES) {
                loadOlder()
                while (loadingOlder) kotlinx.coroutines.delay(JUMP_POLL_MS)
                tries++
            }
            jump = if (messages.any { it.seq == seq }) seq else null
            if (jump == null) error = "原消息已不在本地"
        }
    }

    fun close() {
        val key = open
        if (key != null) messages.lastOrNull()?.let { directory.reportRead(key, it.seq) }
        open = null
        page = ChatPage.CHAT
        replyTo = null
        messages.clear()
        pending.clear()
        reload()
    }

    fun flushRead() {
        val key = open ?: return
        messages.lastOrNull()?.let { directory.reportRead(key, it.seq) }
    }

    /** 发到当前群: 本地先显示, 服务端回来同 cid 的消息后替换。 */
    fun send(text: String): Boolean {
        val key = open ?: return false
        val body = text.trim()
        if (body.isEmpty()) return false
        val cid = UUID.randomUUID().toString()
        val reply = replyTo
        val ref = reply?.let { MsgRef(it.seq, it.src, plainPreview(it.text).take(REPLY_EXCERPT)) }
        val ok = socketSend(Frames.send(cid, body, channelOf(key), reply?.seq))
        pending.add(Pending(cid, body, System.currentTimeMillis(), ref, failed = !ok))
        if (ok) replyTo = null
        return ok
    }

    fun retry(p: Pending) {
        val key = open ?: return
        pending.remove(p)
        val ok = socketSend(Frames.send(p.cid, p.text, channelOf(key), p.reply?.seq))
        pending.add(p.copy(failed = !ok, ts = System.currentTimeMillis()))
    }

    fun forward(msg: ServerFrame.Msg, target: String): Boolean =
        socketSend(Frames.send(UUID.randomUUID().toString(), msg.text, channelOf(target), fwd = msg.seq))

    private fun channelOf(key: String): String? = if (key == MessageDb.MEMO_GROUP) null else key

    /** 新消息已入库后调用: 正在看的群直接追加并标已读, 群列表重算。 */
    fun onMessage(msg: ServerFrame.Msg) {
        val key = msg.groupKey()
        msg.cid?.let { cid -> pending.removeAll { it.cid == cid } }
        if (open == key && messages.none { it.seq == msg.seq }) {
            messages.add(msg)
            markRead(key, msg.seq)
        }
        reload()
    }

    private fun markRead(key: String, seq: Long) {
        scope.launch(Dispatchers.IO) { db.markGroupRead(key, seq) }
    }

    private fun save(next: List<ChatFolder>) {
        folders = next
        val arr = JSONArray(next.map { JSONObject().put("name", it.name).put("groups", JSONArray(it.groups)) })
        scope.launch(Dispatchers.IO) {
            val r = Api.call(context, PATCH, listOf(Constants.SETTINGS_PATH), JSONObject().put(Constants.SETTING_CHAT_FOLDERS, arr))
            withContext(Dispatchers.Main) { error = r.error?.let { "分组没有保存到服务端: $it" } }
        }
    }

    fun clearError() {
        error = null
        directory.error = null
    }

    private companion object {
        const val GET = "GET"
        const val PATCH = "PATCH"
        const val REPLY_EXCERPT = 200
        const val MAX_JUMP_PAGES = 5
        const val JUMP_POLL_MS = 30L
    }
}
