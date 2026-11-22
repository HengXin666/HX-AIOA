package com.hengxin.aioa.ui

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.hengxin.aioa.Constants
import com.hengxin.aioa.net.Api
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

private const val GET = "GET"
private const val POST = "POST"
private const val DELETE = "DELETE"
private const val POLL_MS = 3000L
private const val POLL_LIMIT = "50"
private const val QUERY_SINCE = "since"
private const val QUERY_LIMIT = "limit"
private const val F_NAME = "name"
private const val F_TYPE = "type"
private const val F_ICON = "icon"
private const val F_SUBJECT = "subject"
private const val F_SOURCE = "source"
private const val F_HEAD = "head"

data class SourceType(val type: String, val adapter: String?, val name: String, val icon: String, val setup: String?)

data class SourceItem(val id: String, val name: String, val type: String, val icon: String?, val subject: String?, val keyId: String?)

/** 新建来源后服务端只返回一次的接入信息。hookUrl 只在该类型有 webhook 适配器时存在。 */
data class SourceSetup(val source: SourceItem, val kind: SourceType?, val hookUrl: String?, val key: String, val secret: String)

enum class SourcesScreen { LIST, ADD, RESULT }

/** "数据源" 页的状态: 列表, 新建, 以及新建后监听该来源的第一条事件判断是否已连通。 */
class SourcesState(private val context: Context, private val scope: CoroutineScope) {
    val items = mutableStateListOf<SourceItem>()
    var types by mutableStateOf<List<SourceType>>(emptyList())
        private set
    var loaded by mutableStateOf(false)
        private set
    var busy by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var screen by mutableStateOf(SourcesScreen.LIST)
        private set
    var created by mutableStateOf<SourceSetup?>(null)
        private set
    /** 收到的第一条该来源事件的标题; 非空即已连接。 */
    var connected by mutableStateOf<String?>(null)
        private set
    private var watchJob: Job? = null

    fun refresh() = io {
        val list = Api.call(context, GET, listOf(Constants.SOURCES_PATH))
        val kinds = Api.call(context, GET, listOf(Constants.SOURCE_TYPES_PATH))
        withContext(Dispatchers.Main) {
            list.body?.optJSONArray("sources")?.let { arr -> items.clear(); items.addAll(objects(arr).map(::item)) }
            kinds.body?.optJSONArray("types")?.let { arr -> types = objects(arr).map(::kind).sortedBy { it.type != Constants.SOURCE_GITHUB } }
            error = list.error ?: kinds.error
            loaded = true
        }
    }

    fun startAdd() {
        error = null
        screen = SourcesScreen.ADD
        if (types.isEmpty()) refresh()
    }

    /** 返回键: 子页回到列表; 已在列表时返回 false 交给上一层。 */
    fun back(): Boolean {
        if (screen == SourcesScreen.LIST) return false
        stopWatch()
        created = null
        error = null
        screen = SourcesScreen.LIST
        return true
    }

    fun create(kind: SourceType, name: String, subject: String) {
        if (busy) return
        busy = true
        error = null
        io {
            val body = JSONObject().put(F_NAME, name.trim()).put(F_TYPE, kind.type).put("key", JSONObject())
            if (subject.isNotBlank()) body.put(F_SUBJECT, subject.trim())
            val r = Api.call(context, POST, listOf(Constants.SOURCES_PATH), body)
            val setup = r.body?.let { setupOf(it, kind) }
            withContext(Dispatchers.Main) {
                busy = false
                if (setup == null) {
                    error = r.error ?: "服务端没有返回 key"
                    return@withContext
                }
                items.add(setup.source)
                created = setup
                connected = null
                screen = SourcesScreen.RESULT
                watch(setup.source.id)
            }
        }
    }

    /** 先删 key 让旧地址立即失效, 再删来源。 */
    fun delete(item: SourceItem, then: (() -> Unit)? = null) = io {
        item.keyId?.let { Api.call(context, DELETE, listOf(Constants.KEYS_PATH, it)) }
        val r = Api.call(context, DELETE, listOf(Constants.SOURCES_PATH, item.id))
        withContext(Dispatchers.Main) {
            if (r.error != null) {
                error = "删除失败: ${r.error}"
                return@withContext
            }
            items.removeAll { it.id == item.id }
            then?.invoke()
        }
    }

    /** 服务端没有重新生成接口, key 丢失时删掉重建一个同名来源。 */
    fun recreate() {
        val c = created ?: return
        val kind = c.kind ?: return
        stopWatch()
        delete(c.source) { create(kind, c.source.name, c.source.subject.orEmpty()) }
    }

    /** 实时流里的事件, 比轮询更快。只在主线程调用。 */
    fun onEvent(sourceId: String, title: String) {
        if (connected == null && created?.source?.id == sourceId) {
            connected = title
            stopWatch()
        }
    }

    // 摘要, 静默等路由不一定实时推到界面, 所以另外按序号轮询事件列表兜底
    private fun watch(sourceId: String) {
        stopWatch()
        watchJob = scope.launch(Dispatchers.IO) {
            var head = Api.call(context, GET, listOf(Constants.EVENTS_PATH), query = mapOf(QUERY_LIMIT to "1")).body?.optLong(F_HEAD) ?: 0L
            while (isActive) {
                delay(POLL_MS)
                val r = Api.call(context, GET, listOf(Constants.EVENTS_PATH), query = mapOf(QUERY_SINCE to head.toString(), QUERY_LIMIT to POLL_LIMIT)).body ?: continue
                val hit = objects(r.optJSONArray("events") ?: JSONArray()).firstOrNull { it.optJSONObject(F_SOURCE)?.optString("id") == sourceId }
                head = maxOf(head, r.optLong(F_HEAD))
                if (hit != null) {
                    val title = hit.optJSONObject("data")?.optString("title").orEmpty()
                    withContext(Dispatchers.Main) { onEvent(sourceId, title.ifEmpty { "收到事件" }) }
                }
            }
        }
    }

    private fun stopWatch() {
        watchJob?.cancel()
        watchJob = null
    }

    private fun setupOf(r: JSONObject, kind: SourceType): SourceSetup? {
        val key = r.optJSONObject("key") ?: return null
        val urls = key.optJSONObject("webhookUrls")
        val hook = kind.adapter?.let { urls?.optString(it) }?.ifEmpty { null }
        return SourceSetup(item(r), kind, hook, key.optString("key"), key.optString("webhookSecret"))
    }

    private fun item(o: JSONObject) = SourceItem(
        o.optString("id"),
        o.optString(F_NAME),
        o.optString(F_TYPE),
        o.optString(F_ICON).ifEmpty { null },
        o.optString(F_SUBJECT).ifEmpty { null },
        o.optString("keyId").ifEmpty { null },
    )

    private fun kind(o: JSONObject) = SourceType(
        o.optString(F_TYPE),
        o.optString("adapter").ifEmpty { null },
        o.optString(F_NAME),
        o.optString(F_ICON),
        o.optString("setup").ifEmpty { null },
    )

    private fun objects(arr: JSONArray): List<JSONObject> = (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }

    private fun io(block: suspend () -> Unit) {
        scope.launch(Dispatchers.IO) { runCatching { block() } }
    }

    fun typeOf(item: SourceItem): SourceType? = types.firstOrNull { it.type == item.type }
}
