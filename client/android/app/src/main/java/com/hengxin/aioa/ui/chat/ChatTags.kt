package com.hengxin.aioa.ui.chat

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.hengxin.aioa.Constants
import com.hengxin.aioa.net.Api
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/** 标签的纯运算: 一个会话可以打多个标签, 值形如 { 标签: [channel] }。 */
object TagOps {
    fun of(tags: Map<String, List<String>>, channel: String): List<String> = tags.filterValues { channel in it }.keys.toList()

    /** 把某个会话的标签整体设成 chosen; 不认识的标签名会新建。 */
    fun assign(tags: Map<String, List<String>>, channel: String, chosen: Set<String>): Map<String, List<String>> {
        val out = LinkedHashMap<String, List<String>>()
        tags.forEach { (t, list) -> out[t] = if (t in chosen) (list - channel) + channel else list - channel }
        chosen.filter { it !in tags }.forEach { out[it] = listOf(channel) }
        return out
    }

    fun add(tags: Map<String, List<String>>, name: String): Map<String, List<String>>? {
        val n = name.trim()
        if (n.isEmpty() || n in tags) return null
        return LinkedHashMap(tags).apply { put(n, emptyList()) }
    }

    fun drop(tags: Map<String, List<String>>, name: String): Map<String, List<String>> = LinkedHashMap(tags).apply { remove(name) }
}

// 标签 (#135) 存在账号设置 chatTags 里, 读写与同步照 chatFolders
class ChatTags(private val context: Context, private val scope: CoroutineScope) {
    var tags by mutableStateOf<Map<String, List<String>>>(emptyMap())
        private set
    var error by mutableStateOf<String?>(null)

    fun apply(settings: JSONObject) {
        val o = settings.optJSONObject(Constants.SETTING_CHAT_TAGS) ?: JSONObject()
        val next = LinkedHashMap<String, List<String>>()
        o.keys().forEach { k ->
            val a = o.optJSONArray(k) ?: JSONArray()
            if (k.isNotBlank()) next[k] = (0 until a.length()).mapNotNull { a.optString(it).ifEmpty { null } }.distinct()
        }
        tags = next
    }

    fun of(channel: String): List<String> = TagOps.of(tags, channel)

    fun assign(channel: String, chosen: Set<String>) = save(TagOps.assign(tags, channel, chosen))

    fun add(name: String): Boolean = TagOps.add(tags, name)?.let { save(it); true } ?: false

    fun drop(name: String) = save(TagOps.drop(tags, name))

    /** 群删掉后从所有标签里拿掉。 */
    fun forget(channel: String) {
        if (tags.values.any { channel in it }) save(TagOps.assign(tags, channel, emptySet()))
    }

    private fun save(next: Map<String, List<String>>) {
        tags = next
        val o = JSONObject()
        next.forEach { (k, v) -> o.put(k, JSONArray(v)) }
        scope.launch(Dispatchers.IO) {
            val r = Api.call(context, PATCH, listOf(Constants.SETTINGS_PATH), JSONObject().put(Constants.SETTING_CHAT_TAGS, o))
            withContext(Dispatchers.Main) { error = r.error?.let { "标签没有保存到服务端: $it" } }
        }
    }

    private companion object {
        const val PATCH = "PATCH"
    }
}
