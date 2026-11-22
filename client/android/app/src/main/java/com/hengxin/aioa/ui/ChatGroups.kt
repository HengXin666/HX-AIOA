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
import com.hengxin.aioa.proto.ServerFrame
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/** 组: 把几个群收在一起, 只影响显示。 */
data class ChatFolder(val name: String, val groups: List<String>)

// 群来自消息自带的 channel (推送方决定), 组由用户在客户端整理, 存进账号设置多端同步
class ChatGroups(private val context: Context, private val scope: CoroutineScope, private val db: MessageDb) {
    var summaries by mutableStateOf<List<GroupSummary>>(emptyList())
        private set
    var folders by mutableStateOf<List<ChatFolder>>(emptyList())
        private set
    var open by mutableStateOf<String?>(null)
        private set
    val messages = mutableStateListOf<ServerFrame.Msg>()
    var error by mutableStateOf<String?>(null)
        private set

    fun reload() {
        scope.launch {
            summaries = withContext(Dispatchers.IO) { db.groups() }
        }
    }

    fun loadFolders() = scope.launch(Dispatchers.IO) {
        val r = Api.call(context, GET, listOf(Constants.SETTINGS_PATH))
        val arr = r.body?.optJSONObject("settings")?.optJSONArray(Constants.SETTING_CHAT_FOLDERS)
        val list = (0 until (arr?.length() ?: 0)).mapNotNull { arr?.optJSONObject(it) }.map { o ->
            val g = o.optJSONArray("groups")
            ChatFolder(o.optString("name"), (0 until (g?.length() ?: 0)).map { g!!.optString(it) })
        }.filter { it.name.isNotEmpty() }
        withContext(Dispatchers.Main) { if (r.body != null) folders = list }
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
        messages.clear()
        scope.launch {
            val list = withContext(Dispatchers.IO) { db.inGroup(key, Constants.HISTORY_PAGE) }
            if (open != key) return@launch
            // 读库期间可能已有新消息追加进来, 合并去重
            val merged = (list + messages).distinctBy { it.seq }.sortedBy { it.seq }
            messages.clear()
            messages.addAll(merged)
            list.lastOrNull()?.let { markRead(key, it.seq) }
        }
    }

    fun close() {
        open = null
        messages.clear()
        reload()
    }

    /** 新消息已入库后调用: 正在看的群直接追加并标已读, 群列表重算。 */
    fun onMessage(msg: ServerFrame.Msg) {
        val key = msg.groupKey()
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

    private companion object {
        const val GET = "GET"
        const val PATCH = "PATCH"
    }
}
