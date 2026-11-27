package com.hengxin.aioa.ui.chat

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.hengxin.aioa.data.GroupTitles
import com.hengxin.aioa.data.MutedGroups
import com.hengxin.aioa.net.Api
import com.hengxin.aioa.net.ApiCache
import com.hengxin.aioa.net.ApiReply
import com.hengxin.aioa.proto.ServerFrame
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/** 接入 / 重新接入的结果: 提示词只在这一次带明文 key。 */
data class Onboard(val agent: ChatAgent, val prompt: String, val key: String)

// 群资料与收藏: 先读本地缓存秒出, 再带 ETag 增量刷新; 服务端广播 chat_sync 时再刷一次
/** 当前的群目录 (#139): 邮件转发选群等拿不到 ChatModel 的地方直接用它的 metas, 不再重拉 /chats。 */
object ChatDirectories {
    @Volatile
    var current: ChatDirectory? = null
        internal set
}

class ChatDirectory(private val context: Context, private val scope: CoroutineScope) {
    var metas by mutableStateOf<Map<String, ChatMeta>>(emptyMap())
        private set
    var favorites by mutableStateOf<List<Favorite>>(emptyList())
        private set
    var error by mutableStateOf<String?>(null)
    var onMetas: (() -> Unit)? = null
    private var loaded = false

    init {
        ChatDirectories.current = this
    }

    fun load() {
        scope.launch {
            if (!loaded) {
                val (c, f) = withContext(Dispatchers.IO) { ApiCache.read(context, CACHE_CHATS) to ApiCache.read(context, CACHE_FAVS) }
                applyMetas(parseChats(c))
                favorites = parseFavorites(f)
                loaded = true
            }
            refreshChats()
            refreshFavorites()
            refreshSenders()
        }
    }

    /** chat 为帧里带的那一行 (#129): 直接合并, 不带时照旧整表重拉。 */
    fun onSync(topic: String, chat: JSONObject? = null) {
        when (topic) {
            TOPIC_FAVORITES -> refreshFavorites()
            Senders.TOPIC -> refreshSenders()
            else -> chat?.let(::parseChat)?.let(::applyChat) ?: refreshChats()
        }
    }

    /** 合并一行群资料 (chat_sync 带的, 或新开的单聊)。 */
    fun applyChat(meta: ChatMeta) = applyMetas(metas + (meta.channel to meta))

    /** 本人其它设备的已读位置 (#129 chat_read 帧): 只前进, 不重拉。 */
    fun applyRead(channel: String, read: Long) {
        val cur = metas[channel] ?: return
        if (read > cur.read) applyMetas(metas + (channel to cur.copy(read = read)))
    }

    /** Agent 活跃时间 (#129 agent_active 帧): 只改内存。 */
    fun setAgentActive(channel: String, keyId: String, active: Long) {
        val cur = metas[channel] ?: return
        if (cur.agents.none { it.keyId == keyId }) return
        metas = metas + (channel to cur.copy(agents = cur.agents.map { if (it.keyId == keyId) it.copy(active = active) else it }))
    }

    /** 发送者头像 (#123): 先用缓存, 再问服务端。 */
    fun refreshSenders() = scope.launch {
        withContext(Dispatchers.IO) { ApiCache.read(context, Senders.CACHE) }?.let(Senders::apply)
        val r = withContext(Dispatchers.IO) { ApiCache.refresh(context, Senders.CACHE, listOf(Senders.PATH)) }
        if (r.changed) Senders.apply(r.body)
    }

    /** 主人给发送者换头像: 先上传图片, 再记到发送者上; 返回错误文字, 成功为 null。 */
    suspend fun setSenderAvatar(sid: String, bytes: ByteArray): String? {
        val id = Avatars.upload(context, bytes).getOrElse { return "头像上传失败: ${it.message}" }
        val r = withContext(Dispatchers.IO) { Api.call(context, PUT, listOf(Senders.PATH, sid), JSONObject().put("avatar", id)) }
        if (r.error != null) return "没保存: ${r.error}"
        Senders.setLocal(sid) { it.copy(avatar = id) }
        return null
    }

    /**
     * 改系统发送者的名字; null 恢复默认名。群 Agent (agent) 改的是 Agent 本身的名字 (#139),
     * 服务端同时清掉别名, 本机也照这样改, 群资料随后由 chat_sync 带来。返回错误文字, 成功为 null。
     */
    suspend fun renameSender(sid: String, alias: String?, agent: Boolean = false): String? {
        val r = withContext(Dispatchers.IO) { Api.call(context, PUT, listOf(Senders.PATH, sid), JSONObject().put("alias", alias ?: JSONObject.NULL)) }
        if (r.error != null) return "没保存: ${r.error}"
        Senders.setLocal(sid) { if (agent && alias != null) it.copy(name = alias, alias = null) else it.copy(alias = alias) }
        if (agent) refreshChats()
        return null
    }

    fun clearSenderAvatar(sid: String) {
        Senders.setLocal(sid) { it.copy(avatar = null) }
        scope.launch {
            val r = withContext(Dispatchers.IO) { Api.call(context, PUT, listOf(Senders.PATH, sid), JSONObject().put("avatar", JSONObject.NULL)) }
            if (r.error != null) {
                error = "头像没恢复: ${r.error}"
                refreshSenders()
            }
        }
    }

    /** 手动同步: 群资料与收藏都重新问一遍服务端, 顺带清理不再用的头像。 */
    suspend fun syncNow() {
        listOf(refreshChats(), refreshFavorites()).forEach { it.join() }
        refreshSenders().join()
        val keep = metas.values.mapNotNull { it.avatar }.toSet() + Senders.all()
        withContext(Dispatchers.IO) { Avatars.prune(context, keep) }
    }

    fun refreshChats() = scope.launch {
        val r = withContext(Dispatchers.IO) { ApiCache.refresh(context, CACHE_CHATS, listOf(CHATS)) }
        if (r.changed) applyMetas(parseChats(r.body))
    }

    fun refreshFavorites() = scope.launch {
        val r = withContext(Dispatchers.IO) { ApiCache.refresh(context, CACHE_FAVS, listOf(FAVORITES)) }
        if (r.changed) favorites = parseFavorites(r.body)
    }

    private fun applyMetas(next: Map<String, ChatMeta>) {
        metas = next
        onMetas?.invoke()
        Names.agents(next.values.filter { it.deleted == 0L }.flatMap { it.agents }.mapNotNull { a -> a.sourceId?.let { it to a.name } }.toMap())
        val muted = next.values.filter { it.muted }.map { it.channel }.toSet()
        val titles = next.values.mapNotNull { m -> m.title?.let { m.channel to it } }.toMap()
        scope.launch(Dispatchers.IO) {
            MutedGroups.write(context, muted)
            GroupTitles.write(context, titles)
        }
    }

    fun title(key: String): String = metas[key]?.title ?: key

    fun digests(): List<ChatMeta> = metas.values.filter { it.digest != null }.sortedBy { it.channel }

    /** 改群资料: 本地先改 (界面立即生效), 再发服务端; 失败时提示并以服务端为准。 */
    fun patch(channel: String, body: JSONObject, local: (ChatMeta) -> ChatMeta) {
        val cur = metas[channel] ?: ChatMeta(channel, null, null, false, false, 0, null, emptyList(), System.currentTimeMillis())
        applyMetas(metas + (channel to local(cur)))
        scope.launch {
            val r = withContext(Dispatchers.IO) { Api.call(context, PATCH, listOf(CHATS, channel), body) }
            if (r.error != null) {
                error = "群资料没有保存: ${r.error}"
                refreshChats()
            }
        }
    }

    /** 新建群: 群就是一个名字, 有资料行就会出现在列表里。 */
    fun createGroup(name: String): Boolean {
        val n = name.trim()
        if (n.isEmpty() || n.length > MAX_NAME || metas.containsKey(n)) return false
        patch(n, JSONObject().put("title", n)) { it.copy(title = n) }
        return true
    }

    fun rename(channel: String, title: String) =
        patch(channel, JSONObject().put("title", title.trim().ifEmpty { JSONObject.NULL })) { it.copy(title = title.trim().ifEmpty { null }) }

    fun setMuted(channel: String, on: Boolean) = patch(channel, JSONObject().put("muted", on)) { it.copy(muted = on) }

    /** 群主 / 管理员: 关掉 "正在监听" 或 "正在输入" 提示, 服务端就不再推, 省额度。 */
    fun setHideListening(channel: String, on: Boolean) = patch(channel, JSONObject().put("hideListening", on)) { it.copy(hideListening = on) }

    fun setHideTyping(channel: String, on: Boolean) = patch(channel, JSONObject().put("hideTyping", on)) { it.copy(hideTyping = on) }
    fun setFeed(channel: String, on: Boolean) = (if (on) VIEW_FEED else VIEW_CHAT).let { v -> patch(channel, JSONObject().put("view", v)) { it.copy(view = v) } }

    /** 群主改信息流标签表; null 恢复默认。改了 Agent 的专属指令会跟着更新。 */
    fun setFeedTags(channel: String, tags: List<com.hengxin.aioa.ui.feed.FeedTag>?) =
        patch(channel, JSONObject().put("feedTags", tags?.let { t -> org.json.JSONArray(t.map { it.json() }) } ?: JSONObject.NULL)) { it.copy(feedTags = tags.orEmpty()) }

    fun setPinned(channel: String, on: Boolean) = patch(channel, JSONObject().put("pinned", on)) { it.copy(pinned = on) }

    fun setDigest(channel: String, kind: String?) = patch(channel, JSONObject().put("digest", kind ?: JSONObject.NULL)) { it.copy(digest = kind) }

    /** 头像传完后保存: 在应用级作用域里调, 页面或 ViewModel 已不在也能存上; 返回错误信息, 成功为 null。 */
    suspend fun saveAvatar(channel: String, id: String): String? {
        val r = withContext(Dispatchers.IO) { Api.call(context, PATCH, listOf(CHATS, channel), JSONObject().put("avatar", id)) }
        if (r.error == null) metas[channel]?.let { applyMetas(metas + (channel to it.copy(avatar = id))) }
        return r.error
    }

    fun setAvatar(channel: String, id: String?) = patch(channel, JSONObject().put("avatar", id ?: JSONObject.NULL)) { it.copy(avatar = id) }

    /** 已读位置同步给其它设备; 只前进。 */
    fun reportRead(channel: String, seq: Long) {
        if (seq <= (metas[channel]?.read ?: 0)) return
        patch(channel, JSONObject().put("read", seq)) { it.copy(read = seq) }
    }

    fun isFavorite(seq: Long): Boolean = favorites.any { it.seq == seq }

    fun toggleFavorite(msg: ServerFrame.Msg) {
        val on = isFavorite(msg.seq)
        favorites = if (on) favorites.filter { it.seq != msg.seq } else listOf(Favorite(msg.seq, System.currentTimeMillis(), msg)) + favorites
        scope.launch {
            val r = withContext(Dispatchers.IO) { Api.call(context, if (on) DELETE else PUT, listOf(FAVORITES, msg.seq.toString())) }
            if (r.error != null) error = "收藏没有同步: ${r.error}"
            refreshFavorites()
        }
    }

    /** 接入; interval (秒) 与 task 只写进这次的接入语。 */
    suspend fun addAgent(channel: String, name: String, reads: List<String>, interval: Int? = null, task: String? = null): Result<Onboard> =
        onboard {
            val body = agentBody(name, reads)
            interval?.let { body.put("interval", it) }
            task?.trim()?.takeIf { it.isNotEmpty() }?.let { body.put("task", it) }
            Api.call(context, POST, listOf(CHATS, channel, AGENTS), body)
        }

    suspend fun rotate(channel: String, keyId: String): Result<Onboard> =
        onboard { Api.call(context, POST, listOf(CHATS, channel, AGENTS, keyId, "rotate")) }

    suspend fun savedPrompt(channel: String, keyId: String): Result<String> = withContext(Dispatchers.IO) {
        val r = Api.call(context, GET, listOf(CHATS, channel, AGENTS, keyId, "prompt"))
        r.body?.optString("prompt")?.let { Result.success(it) } ?: Result.failure(Exception(r.error))
    }

    /** 改名后服务端清掉发送者别名 (#139), 本机同步清掉, 页面上马上看到新名字。 */
    suspend fun editAgent(channel: String, keyId: String, name: String, reads: List<String>): String? = withContext(Dispatchers.IO) {
        Api.call(context, PATCH, listOf(CHATS, channel, AGENTS, keyId), agentBody(name, reads)).error
    }.also { err ->
        if (err == null) metas[channel]?.agents?.firstOrNull { it.keyId == keyId }?.sourceId?.let { sid -> Senders.setLocal(sid) { it.copy(name = name.trim(), alias = null) } }
        refreshChats()
    }

    /** 大更新自动执行开关; 服务端会把接入版本加 1, 之后要把新接入语发给 Agent 一次。 */
    suspend fun setAutoMajor(channel: String, keyId: String, on: Boolean): String? = withContext(Dispatchers.IO) {
        Api.call(context, PATCH, listOf(CHATS, channel, AGENTS, keyId), JSONObject().put("autoMajor", on)).error
    }.also { refreshChats() }

    suspend fun removeAgent(channel: String, keyId: String): String? = withContext(Dispatchers.IO) {
        Api.call(context, DELETE, listOf(CHATS, channel, AGENTS, keyId)).error
    }.also { refreshChats() }

    private suspend fun onboard(call: () -> ApiReply): Result<Onboard> = withContext(Dispatchers.IO) { call() }.let { r ->
        refreshChats()
        val b = r.body ?: return Result.failure(Exception(r.error))
        runCatching { Onboard(parseAgent(b.getJSONObject("agent")), b.optString("prompt"), b.optString("key")) }
    }

    /** 清空群消息, 成功时返回清到的 seq; 在 IO 线程调用。 */
    fun clear(channel: String): Result<Long> {
        val r = Api.call(context, DELETE, listOf(CHATS, channel, MESSAGES))
        return r.error?.let { Result.failure(Exception(it)) } ?: Result.success(r.body?.optLong("cleared") ?: 0L)
    }

    /** 删除群 (母号): 服务端删消息, Agent, 成员, 只留墓碑; 返回删到的 seq。 */
    fun deleteGroup(channel: String): Result<Long> {
        val r = Api.call(context, DELETE, listOf(CHATS, channel))
        return r.error?.let { Result.failure(Exception(it)) } ?: Result.success(r.body?.optLong("cleared") ?: 0L)
    }

    private fun agentBody(name: String, reads: List<String>) =
        JSONObject().put("name", name.trim()).put("reads", JSONArray(reads))

    private companion object {
        const val CHATS = "api/v1/chats"
        const val FAVORITES = "api/v1/favorites"
        const val AGENTS = "agents"
        const val MESSAGES = "messages"
        const val CACHE_CHATS = "chats"
        const val CACHE_FAVS = "favorites"
        const val TOPIC_FAVORITES = "favorites"
        const val GET = "GET"
        const val POST = "POST"
        const val PUT = "PUT"
        const val PATCH = "PATCH"
        const val DELETE = "DELETE"
        const val MAX_NAME = 64
    }
}
