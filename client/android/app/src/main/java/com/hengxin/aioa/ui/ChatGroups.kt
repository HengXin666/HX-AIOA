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
import com.hengxin.aioa.data.replacedBy
import com.hengxin.aioa.net.Api
import com.hengxin.aioa.proto.Frames
import com.hengxin.aioa.proto.MsgRef
import com.hengxin.aioa.proto.ServerFrame
import com.hengxin.aioa.ui.chat.ChatDirectory
import com.hengxin.aioa.ui.chat.ChatHistory
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
/** 还没回执的本机消息; upload 非空表示带附件, progress 为上传进度, error 为上传失败原因。 */
data class Pending(
    val cid: String,
    val text: String,
    val ts: Long,
    val reply: MsgRef?,
    val failed: Boolean = false,
    val upload: android.net.Uri? = null,
    val progress: Float? = null,
    val error: String? = null,
)

private const val PROGRESS_STEP = 0.02f
// 只发文件时的正文, 通知和列表预览用它; 气泡里有文件卡时不再重复显示
const val FILE_TEXT_PREFIX = "[文件] "

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
    val presence = com.hengxin.aioa.ui.chat.ChatPresence()
    private var typedAt = 0L
    var summaries by mutableStateOf<List<GroupSummary>>(emptyList())
        private set
    var folders by mutableStateOf<List<ChatFolder>>(emptyList())
        private set
    var open by mutableStateOf<String?>(null)
        private set
    var page by mutableStateOf(ChatPage.CHAT)
    var favoritesOpen by mutableStateOf(false)
    // 从邀请链接拉起 App 时带来的邀请码, 群列表看到后弹出加入框
    var pendingInvite by mutableStateOf<String?>(null)
    /** 别的页要求打开某个群时加一, 主界面据此切到消息栏。 */
    var focusTick by mutableStateOf(0)
        private set
    /** 自己发出一条就加一, 消息列表据此滚到底部。 */
    var sendTick by mutableStateOf(0)
        private set
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
    private var cloudEnd = false
    private val history = ChatHistory(context)
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
        // 没消息的群在建过资料或清空过时显示
        // 清空过的群也留着: 清空只删消息, 不删群
        val empty = metas.values.filter { it.channel !in known && it.deleted == 0L && (it.configured || it.cleared > 0) }.map { GroupRowData(it.channel, it, null, 0) }
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
            // 别的设备删了正在看的群
            if (metas.any { it.channel == open && it.deleted > 0 } && messages.isEmpty()) close()
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

    /** 删除群: 服务端连 Agent 与成员一起删, 本地删记录, 移出分组, 正在看就退出。 */
    fun deleteGroup(key: String, done: (String?) -> Unit) {
        scope.launch {
            val r = withContext(Dispatchers.IO) { directory.deleteGroup(key) }
            r.onSuccess { upTo ->
                withContext(Dispatchers.IO) { db.clearGroup(key, upTo) }
                onCleared?.invoke(key, upTo)
                if (open == key) close()
                if (folders.any { key in it.groups }) save(folders.map { it.copy(groups = it.groups - key) })
                directory.refreshChats()
                reload()
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

    // 第几次打开群: 消息列表的保存状态按次区分, 重新进群从最新一条开始
    var visit = 0
        private set

    fun openGroup(key: String) {
        if (open == key) return
        visit += 1
        open = key
        page = ChatPage.CHAT
        replyTo = null
        messages.clear()
        pending.clear()
        hasMore = false
        cloudEnd = false
        fromDb(key, first = true)
    }

    /** 回到前台时重读正在看的群: 后台期间 :link 进程收进库的消息, 界面连接不会再补发。 */
    fun refreshOpen() {
        open?.let { fromDb(it, first = false) }
    }

    private fun fromDb(key: String, first: Boolean) = scope.launch {
        val list = withContext(Dispatchers.IO) { db.inGroup(key, Constants.HISTORY_PAGE) }
        if (open != key) return@launch
        // 本地不满一页也允许继续上翻, 由云端补
        if (first) hasMore = true
        // 读库期间可能已有新消息追加进来, 合并去重; 已加载的更早几页保留
        val merged = (list + messages).distinctBy { it.seq }.sortedBy { it.seq }
        if (merged.size != messages.size) {
            messages.clear()
            messages.addAll(merged)
        }
        // 进群就算读到最后一条, 不管这次有没有新行
        merged.lastOrNull()?.let { markRead(key, it.seq) }
        if (first && list.size < Constants.HISTORY_PAGE) loadOlder()
    }

    /** 上滑到顶时向前翻一页: 先读本地库, 本地不够一页再向云端要更早的并落库。 */
    fun loadOlder() {
        val key = open ?: return
        val first = messages.firstOrNull()?.seq ?: Long.MAX_VALUE
        if (loadingOlder || !hasMore) return
        loadingOlder = true
        scope.launch {
            val list = withContext(Dispatchers.IO) {
                val local = db.inGroup(key, Constants.HISTORY_PAGE, first)
                if (local.size >= Constants.HISTORY_PAGE) return@withContext local
                val remote = history.before(key, local.firstOrNull()?.seq ?: first, Constants.HISTORY_PAGE - local.size)
                remote.forEach { db.insert(it) }
                // 云端也翻到头了才算没有更多
                cloudEnd = remote.size < Constants.HISTORY_PAGE - local.size
                remote.filter { it.deleted != MessageDb.DELETE_MODE } + local
            }
            if (open == key) {
                messages.addAll(0, list.filter { m -> messages.none { it.seq == m.seq } })
                hasMore = !cloudEnd || list.size >= Constants.HISTORY_PAGE
            }
            loadingOlder = false
        }
    }

    /** 撤回或删除一条消息: 成功后按服务端返回的墓碑直接更新, 其它设备由推送同步。 */
    fun remove(msg: ServerFrame.Msg, mode: String) {
        scope.launch {
            val r = withContext(Dispatchers.IO) { history.remove(msg.seq, mode).onSuccess { db.insert(it) } }
            r.onSuccess { onMessage(it) }.onFailure { error = it.message }
        }
    }

    /** 服务端说本机断线太久: 丢掉 floor 之前的本地缓存, 正在看的群重读。 */
    fun dropBefore(floor: Long) {
        scope.launch {
            withContext(Dispatchers.IO) { db.dropBefore(floor) }
            open?.let { key -> messages.removeAll { it.seq < floor }; fromDb(key, first = false) }
            reload()
        }
    }

    /** 从待办, 插件页等处打开某个群; seq 大于 0 时再翻到那条消息。 */
    fun openAt(key: String, seq: Long) {
        openGroup(key)
        focusTick += 1
        if (seq <= 0) return
        scope.launch {
            var waited = 0
            while (messages.isEmpty() && waited < OPEN_WAIT_TRIES) {
                kotlinx.coroutines.delay(JUMP_POLL_MS)
                waited++
            }
            jumpTo(seq)
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

    /** 正在输入: 每 TYPING_THROTTLE_MS 最多报一次; 备忘和关了提示的群不报。 */
    fun typing() {
        val key = open ?: return
        val now = System.currentTimeMillis()
        if (key == MessageDb.MEMO_GROUP || directory.metas[key]?.hideTyping == true || now - typedAt < Constants.TYPING_THROTTLE_MS) return
        if (socketSend(Frames.typing(key))) typedAt = now
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
        typedAt = 0L
        pending.add(Pending(cid, body, System.currentTimeMillis(), ref, failed = !ok))
        sendTick += 1
        if (ok) replyTo = null
        return ok
    }

    /** 发文件: 先上传 (显示进度), 传完再发一条带附件的消息; caption 为空时正文写 "[文件] 名字"。 */
    fun sendFile(uri: android.net.Uri, caption: String, retryOf: Pending? = null) {
        val key = open ?: return
        val name = runCatching { com.hengxin.aioa.ui.chat.FileTransfer.describe(context, uri).first }.getOrDefault("文件")
        val text = caption.trim().ifEmpty { "$FILE_TEXT_PREFIX$name" }
        val reply = retryOf?.reply ?: replyTo?.let { MsgRef(it.seq, it.src, plainPreview(it.text).take(REPLY_EXCERPT)) }
        val p0 = Pending(retryOf?.cid ?: UUID.randomUUID().toString(), text, System.currentTimeMillis(), reply, upload = uri, progress = 0f)
        retryOf?.let { pending.remove(it) }
        pending.add(p0)
        sendTick += 1
        replyTo = null
        val update = { next: Pending -> pending.indexOfFirst { it.cid == p0.cid }.takeIf { it >= 0 }?.let { pending[it] = next } }
        scope.launch {
            var last = 0f
            val r = com.hengxin.aioa.ui.chat.FileTransfer.upload(context, uri, channelOf(key)) { f ->
                // 每 2% 刷一次界面就够了
                if (f - last >= PROGRESS_STEP || f >= 1f) {
                    last = f
                    scope.launch { update(p0.copy(progress = f)) }
                }
            }
            r.onSuccess { ref ->
                val ok = socketSend(Frames.send(p0.cid, text, channelOf(key), reply?.seq, file = ref.id))
                update(p0.copy(progress = null, failed = !ok))
            }.onFailure { update(p0.copy(progress = null, failed = true, error = it.message)) }
        }
    }

    fun retry(p: Pending) {
        val key = open ?: return
        if (p.upload != null) return sendFile(p.upload, if (p.text.startsWith(FILE_TEXT_PREFIX)) "" else p.text, p)
        pending.remove(p)
        val ok = socketSend(Frames.send(p.cid, p.text, channelOf(key), p.reply?.seq))
        pending.add(p.copy(failed = !ok, ts = System.currentTimeMillis()))
    }

    fun forward(msg: ServerFrame.Msg, target: String): Boolean =
        socketSend(Frames.send(UUID.randomUUID().toString(), msg.text, channelOf(target), fwd = msg.seq))

    private fun channelOf(key: String): String? = if (key == MessageDb.MEMO_GROUP) null else key

    /** 新消息已入库后调用: 正在看的群直接追加并标已读, 群列表重算; 墓碑替换或删掉原消息。 */
    fun onMessage(msg: ServerFrame.Msg) {
        val key = msg.groupKey()
        msg.cid?.let { cid -> pending.removeAll { it.cid == cid } }
        if (open == key) messages.removeAll { it.replacedBy(msg) }
        if (replyTo?.replacedBy(msg) == true) replyTo = null
        if (open == key && msg.deleted != MessageDb.DELETE_MODE && messages.none { it.seq == msg.seq }) {
            messages.add(msg)
            markRead(key, msg.seq)
        }
        reload()
    }

    /** 总览里看过或划掉的消息: 逐条标已读不进未读数; 某群因此读完时推进整群已读位置并同步到其它设备。 */
    fun markSeen(seqs: Collection<Long>) {
        if (seqs.isEmpty()) return
        scope.launch {
            val done = withContext(Dispatchers.IO) {
                db.markSeen(seqs).mapNotNull { key ->
                    val (unread, last) = db.groupState(key)
                    if (unread > 0 || last <= 0) return@mapNotNull null
                    db.markGroupRead(key, last)
                    key to last
                }
            }
            done.forEach { (key, last) -> directory.reportRead(key, last) }
            reload()
        }
    }

    // 写完已读位置再重算群列表, 未读角标立刻消失
    private fun markRead(key: String, seq: Long) {
        scope.launch {
            withContext(Dispatchers.IO) { db.markGroupRead(key, seq) }
            reload()
        }
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
        const val OPEN_WAIT_TRIES = 40
    }
}
