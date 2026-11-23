package com.hengxin.aioa.ui

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.hengxin.aioa.Constants
import com.hengxin.aioa.config.Auth
import com.hengxin.aioa.config.ConfigStore
import com.hengxin.aioa.kit.ChatLine
import com.hengxin.aioa.kit.ChatRole
import com.hengxin.aioa.kit.LayoutChange
import com.hengxin.aioa.kit.Space
import com.hengxin.aioa.kit.TodoRow
import com.hengxin.aioa.kit.apply
import com.hengxin.aioa.net.Net
import com.hengxin.aioa.proto.Envelope
import com.hengxin.aioa.proto.MetricPoint
import com.hengxin.aioa.proto.ServerFrame
import com.hengxin.aioa.proto.V1Decode
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

private const val ROLE_USER = "user"
private const val ROLE_SYSTEM = "system"
private const val KEY_TEXT = "text"
private const val JSON_TYPE = "application/json"
private const val KEY_TODOS = "todos"
private const val TOPIC_TODOS = "todos"

/** 工作台的界面状态: 布局来自 space_update 帧, 用户的排序与尺寸 PUT 到服务端, 打开时取一次服务端解析好的当前值。 */
class SpacesState(
    private val context: Context,
    private val scope: CoroutineScope,
    private val metrics: MetricsState,
) {
    val spaces = mutableStateListOf<Space>()
    var currentId by mutableStateOf<String?>(null)
    var editing by mutableStateOf(false)
    val logs = mutableStateMapOf<String, List<ChatLine>>()
    /** /data 接口带回的最近事件, 补充流里还没有的部分。 */
    val events = mutableStateMapOf<String, Envelope>()
    /** 群下的待办: 组件第一次显示某个群时拉一次, 之后收到 todos 同步再拉。 */
    val todos = mutableStateMapOf<String, List<TodoRow>>()
    private val todoAsked = HashSet<String>()
    private val primed = HashSet<String>()
    private val asked = HashSet<String>()

    fun onFrame(frame: ServerFrame): Boolean {
        when (frame) {
            is ServerFrame.SpaceUpdate -> {
                val i = spaces.indexOfFirst { it.id == frame.id }
                if (frame.deleted) {
                    if (i >= 0) spaces.removeAt(i)
                    return true
                }
                val raw = JSONObject(frame.raw).optJSONObject("space") ?: return true
                val space = runCatching { SpaceDecode.space(raw) }.getOrNull() ?: return true
                if (i >= 0) spaces[i] = space else spaces.add(space)
            }
            is ServerFrame.ChatSync -> {
                if (frame.topic != TOPIC_TODOS) return false
                frame.channel?.takeIf { it in todoAsked }?.let(::loadTodos)
            }
            is ServerFrame.TaskLog -> {
                if (frame.taskId in logs) logs[frame.taskId] = logs[frame.taskId].orEmpty() + line(frame.role, frame.text ?: frame.kind)
            }
            else -> return false
        }
        return true
    }

    fun pick(id: String) {
        currentId = id
        prime(id)
    }

    /** 本地立即生效, 再异步保存; 服务端回的 space_update 会再同步一次。 */
    fun change(space: Space, change: LayoutChange) {
        val next = space.copy(layout = space.layout.apply(change))
        val i = spaces.indexOfFirst { it.id == space.id }
        if (i >= 0) spaces[i] = next
        val body = SpaceDecode.layoutPatch(next.layout, change is LayoutChange.Size)
        io { call(url(Constants.SPACES_PATH, space.id, "state"), "PUT", body) }
    }

    fun appendMine(taskId: String, text: String) {
        logs[taskId] = logs[taskId].orEmpty() + ChatLine(ChatRole.User, text)
    }

    /** 对话组件首次显示某个任务时拉一次完整对话历史。 */
    fun chat(taskId: String): List<ChatLine> {
        if (asked.add(taskId)) {
            io {
                val r = call(url(Constants.TASKS_PATH, taskId), "GET", null) ?: return@io
                val log = r.optJSONArray("log") ?: JSONArray()
                val lines = (0 until log.length()).mapNotNull { log.optJSONObject(it) }.map { line(it.optString("role"), it.optString(KEY_TEXT).ifEmpty { it.optString("kind") }) }
                withContext(Dispatchers.Main) { logs[taskId] = lines }
            }
        }
        return logs[taskId].orEmpty()
    }

    fun prime(id: String) {
        if (!primed.add(id)) return
        io {
            val r = call(url(Constants.SPACES_PATH, id, "data"), "GET", null) ?: return@io
            val values = r.optJSONArray("values") ?: JSONArray()
            val evs = r.optJSONArray("events") ?: JSONArray()
            withContext(Dispatchers.Main) {
                for (i in 0 until values.length()) {
                    val v = values.optJSONObject(i) ?: continue
                    metrics.prime(v.optString("subject"), MetricPoint(v.optLong("ts"), mapOf(v.optString("field") to v.optDouble("value"))))
                }
                for (i in 0 until evs.length()) {
                    runCatching { V1Decode.envelope(evs.getJSONObject(i)) }.getOrNull()?.let { events[it.id] = it }
                }
            }
        }
    }

    fun todos(channel: String): List<TodoRow>? {
        if (todoAsked.add(channel)) loadTodos(channel)
        return todos[channel]
    }

    /** 勾选本地先生效, 失败时以服务端为准重拉。 */
    fun setTodo(channel: String, row: TodoRow, done: Boolean) {
        val state = if (done) TodoRow.STATE_DONE else TodoRow.STATE_OPEN
        todos[channel] = todos[channel].orEmpty().map { if (it.id == row.id) it.copy(state = state, updated = System.currentTimeMillis()) else it }
        val body = JSONObject().put(KEY_TODOS, JSONArray().put(JSONObject().put("id", row.id).put("state", state)))
        io { if (call(url(Constants.CHATS_API, channel, KEY_TODOS), "POST", body) == null) loadTodos(channel) }
    }

    private fun loadTodos(channel: String) = io {
        val arr = call(url(Constants.CHATS_API, channel, KEY_TODOS), "GET", null)?.optJSONArray(KEY_TODOS) ?: return@io
        val rows = (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }.map { o ->
            TodoRow(
                id = o.optString("id"),
                title = o.optString("title"),
                note = o.optString("note").ifEmpty { null },
                state = o.optString("state", TodoRow.STATE_OPEN),
                prio = o.optInt("prio", 2),
                src = o.optLong("src").takeIf { it > 0 },
                updated = o.optLong("updated"),
            )
        }
        withContext(Dispatchers.Main) { todos[channel] = rows }
    }

    private fun line(role: String, text: String) = ChatLine(
        when (role) {
            ROLE_USER -> ChatRole.User
            ROLE_SYSTEM -> ChatRole.System
            else -> ChatRole.Agent
        },
        text,
    )

    private fun io(block: suspend () -> Unit) {
        scope.launch(Dispatchers.IO) { runCatching { block() } }
    }

    private fun url(vararg segments: String): HttpUrl? {
        val config = ConfigStore.load(context) ?: return null
        val b = runCatching { config.server.toHttpUrl().newBuilder() }.getOrNull() ?: return null
        segments.forEachIndexed { i, s -> if (i == 0) b.addPathSegments(s) else b.addPathSegment(s) }
        return b.build()
    }

    private fun call(url: HttpUrl?, method: String, body: JSONObject?): JSONObject? {
        val config = ConfigStore.load(context) ?: return null
        val target = url ?: return null
        val req = Request.Builder().url(target)
            .header("Authorization", "Bearer ${Auth.bearer(context, config)}")
            .method(method, body?.toString()?.toRequestBody(JSON_TYPE.toMediaType()))
            .build()
        Net.client(context).newCall(req).execute().use { res ->
            if (!res.isSuccessful) return null
            return runCatching { JSONObject(res.body?.string().orEmpty()) }.getOrNull()
        }
    }
}
