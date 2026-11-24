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
class ChatDirectory(private val context: Context, private val scope: CoroutineScope) {
    var metas by mutableStateOf<Map<String, ChatMeta>>(emptyMap())
        private set
    var favorites by mutableStateOf<List<Favorite>>(emptyList())
        private set
    var error by mutableStateOf<String?>(null)
    var onMetas: (() -> Unit)? = null
    private var loaded = false

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
        }
    }

    fun onSync(topic: String) {
        if (topic == TOPIC_FAVORITES) refreshFavorites() else refreshChats()
    }

    /** 手动同步: 群资料与收藏都重新问一遍服务端, 顺带清理不再用的头像。 */
    suspend fun syncNow() {
        listOf(refreshChats(), refreshFavorites()).forEach { it.join() }
        val keep = metas.values.mapNotNull { it.avatar }.toSet()
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

    fun setPinned(channel: String, on: Boolean) = patch(channel, JSONObject().put("pinned", on)) { it.copy(pinned = on) }

    fun setDigest(channel: String, kind: String?) = patch(channel, JSONObject().put("digest", kind ?: JSONObject.NULL)) { it.copy(digest = kind) }

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

    suspend fun editAgent(channel: String, keyId: String, name: String, reads: List<String>): String? = withContext(Dispatchers.IO) {
        Api.call(context, PATCH, listOf(CHATS, channel, AGENTS, keyId), agentBody(name, reads)).error
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
