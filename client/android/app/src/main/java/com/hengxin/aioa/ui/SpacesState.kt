package com.hengxin.aioa.ui

import android.content.Context
import android.widget.Toast
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
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
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
private const val TOPIC_TODOS = "todos"
private const val KEY_ID = "id"
private const val KEY_BODY = "body"
private const val KEY_STATE = "state"
private const val KEY_TODOS_SYNC = "todos-sync"
private const val HTTP_CONFLICT = 409
private const val CHANGE_DISABLED = "disabled"
private const val CHANGE_REVOKED = "revoked"
// todos 里这个键放本账号全部群的待办
const val ALL_TODOS = "*"

private fun JSONObject.optPositive(k: String): Long? = optLong(k).takeIf { it > 0 }

/** pdata 的一行待办 (id = <群>:<待办 id>, body 是整行) -> (群, TodoRow); 更新时间用行自带的 updated。 */
internal fun todoRow(o: JSONObject): Pair<String, TodoRow>? {
    val b = o.optJSONObject(KEY_BODY) ?: return null
    val channel = b.optString("channel").ifEmpty { return null }
    val gh = b.optJSONObject("gh")
    return channel to TodoRow(
        id = o.optString(KEY_ID).removePrefix("$channel:"),
        title = b.optString("title"),
        note = b.optString("note").ifEmpty { null },
        state = b.optString(KEY_STATE, TodoRow.STATE_OPEN),
        prio = b.optInt("prio", 2),
        src = b.optPositive("src"),
        updated = o.optLong("updated"),
        created = b.optLong("created"),
        doneAt = b.optPositive("doneAt"),
        repo = b.optString("repo").ifEmpty { null },
        issue = b.optPositive("issue")?.toInt(),
        parent = b.optString("parent").ifEmpty { null },
        ghOpen = gh?.let { it.optString("state") != "closed" },
        ghComments = gh?.optInt("comments") ?: 0,
        ghParent = gh?.optPositive("parent")?.toInt(),
        channel = channel,
        area = b.optString("area").ifEmpty { null },
        due = b.optPositive("due"),
        remind = if (b.has("remind") && !b.isNull("remind")) b.optInt("remind") else null,
        alarm = b.optBoolean("alarm"),
        star = b.optBoolean("star"),
        everyUnit = b.optJSONObject("every")?.optString("unit")?.ifEmpty { null },
        everyN = b.optJSONObject("every")?.optInt("n", 1) ?: 1,
        runs = b.optInt("runs"),
    )
}

/** 待办里 App 能改的计划字段写进行 body; null 的删掉 (服务端按缺省处理)。 */
internal fun planInto(body: JSONObject, r: TodoRow) {
    fun opt(k: String, v: Any?) { if (v == null) body.remove(k) else body.put(k, v) }
    body.put("title", r.title).put("prio", r.prio).put(KEY_STATE, r.state)
    opt("note", r.note)
    opt("area", r.area)
    opt("due", r.due)
    opt("remind", r.remind?.takeIf { r.due != null })
    opt("alarm", r.alarm.takeIf { it && r.due != null })
    opt("star", r.star.takeIf { it })
    val tz = java.util.TimeZone.getDefault().getOffset(r.due ?: System.currentTimeMillis()) / TodoRow.MINUTE_MS.toInt()
    opt("every", r.everyUnit?.takeIf { r.due != null }?.let { JSONObject().put("unit", it).put("n", r.everyN).put("tz", tz) })
}

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
    /** 群下的待办: 数据在插件数据 pdata (各群共用一个集合), 组件第一次显示时拉一次, 之后收到 pdata_sync 按 rev 增量拉。 */
    val todos = mutableStateMapOf<String, List<TodoRow>>()
    private val todoAsked = HashSet<String>()
    // pdata 行原文 (id, ver, body), 写回时要带 ver; 只在 todoLock 里改
    private val todoRows = HashMap<String, JSONObject>()
    private var todoRev = 0L
    private val todoLock = Mutex()
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
            // 新版待办只认 pdata_sync, 旧的 chat_sync todos 留给没升级的客户端
            is ServerFrame.ChatSync -> if (frame.topic != TOPIC_TODOS) return false
            is ServerFrame.PDataSync -> {
                if (frame.plugin != Constants.TODO_PLUGIN || frame.coll != Constants.TODO_COLL) return false
                if (frame.rev > todoRev && todoAsked.isNotEmpty()) pullTodos()
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
        if (todoAsked.add(channel)) pullTodos()
        return todos[channel]
    }

    /** 本账号所有群的待办 (总览的看板, 重点待办)。 */
    fun allTodos(): List<TodoRow>? = todos(ALL_TODOS)

    /** 新建或整条编辑: 新建 ver 为 0, 编辑在读到的整行上改计划字段 (保留 src, gh, created 等)。 */
    fun saveTodo(row: TodoRow, fresh: Boolean) {
        val id = "${row.channel}:${row.id}"
        val now = System.currentTimeMillis()
        if (fresh) todos[ALL_TODOS]?.let { todos[ALL_TODOS] = it + row.copy(created = now, updated = now) }
        if (fresh && row.channel in todos) todos[row.channel] = todos[row.channel].orEmpty() + row.copy(created = now, updated = now)
        if (!fresh) return patchTodo(row.channel, row) { planInto(it, row) }
        io {
            val body = JSONObject().put("channel", row.channel).put("created", now).also { planInto(it, row) }
            val err = callErr(url(Constants.PDATA_API, Constants.TODO_PLUGIN, Constants.TODO_COLL, id), "PUT", JSONObject().put("ver", 0).put(KEY_BODY, body))
            if (err != null) toast("待办没保存: ${err.second}")
            pullTodos()
        }
    }

    /** 删除写墓碑, 带读到的版本。 */
    fun deleteTodo(row: TodoRow) {
        for (k in todos.keys.toList()) todos[k] = todos[k].orEmpty().filter { !(it.id == row.id && it.channel == row.channel) }
        val id = "${row.channel}:${row.id}"
        io {
            val ver = todoLock.withLock { todoRows[id] }?.optInt("ver") ?: return@io pullTodos()
            val target = url(Constants.PDATA_API, Constants.TODO_PLUGIN, Constants.TODO_COLL, id)?.newBuilder()?.addQueryParameter("ver", ver.toString())?.build()
            val err = callErr(target, "DELETE", null)
            if (err != null && err.first != HTTP_CONFLICT) toast("没删掉: ${err.second}")
            pullTodos()
        }
    }

    private suspend fun toast(text: String) = withContext(Dispatchers.Main) { Toast.makeText(context, text, Toast.LENGTH_SHORT).show() }

    /** 勾选本地先生效, 再带 ver 写回; 版本冲突或失败时以服务端为准重拉。 */
    fun setTodo(channel: String, row: TodoRow, done: Boolean) = setState(channel, row, if (done) TodoRow.STATE_DONE else TodoRow.STATE_OPEN)

    fun setState(channel: String, row: TodoRow, state: String) = patchTodo(channel, row.copy(state = state)) { it.put(KEY_STATE, state) }

    fun setPrio(channel: String, row: TodoRow, prio: Int) = patchTodo(channel, row.copy(prio = prio)) { it.put("prio", prio) }

    /** 改一条: 本地先换成 next, 再在读到的整行上改要改的字段, 带 ver 写回 (doneAt 与 gh 由服务端补)。 */
    private fun patchTodo(group: String, next: TodoRow, edit: (JSONObject) -> Unit) {
        val channel = next.channel.ifEmpty { group }
        val now = System.currentTimeMillis()
        for (k in listOf(channel, ALL_TODOS)) todos[k]?.let { list -> todos[k] = list.map { if (it.id == next.id && it.channel == channel) next.copy(updated = now) else it } }
        val id = "$channel:${next.id}"
        io {
            val cur = todoLock.withLock { todoRows[id] } ?: return@io pullTodos()
            val body = JSONObject(cur.optJSONObject(KEY_BODY)?.toString() ?: "{}").also(edit)
            val put = JSONObject().put("ver", cur.optInt("ver")).put(KEY_BODY, body)
            val err = callErr(url(Constants.PDATA_API, Constants.TODO_PLUGIN, Constants.TODO_COLL, id), "PUT", put)
            // 版本冲突不提示 (重拉即可), 其它错误 (如 id 太长, 没启用) 告诉用户, 不再悄悄吞掉
            if (err != null && err.first != HTTP_CONFLICT) toast("待办没保存: ${err.second}")
            pullTodos()
        }
    }

    /** 待办插件停用或被撤销: 丢掉本地副本 (下次启用从头拉); 重新启用或换版本就补拉一次。 */
    fun onPlugin(id: String, change: String) {
        if (id != Constants.TODO_PLUGIN) return
        if (change == CHANGE_DISABLED || change == CHANGE_REVOKED) {
            io {
                todoLock.withLock {
                    todoRows.clear()
                    todoRev = 0L
                }
                com.hengxin.aioa.link.TodoAlarms.sync(context, emptyList())
                withContext(Dispatchers.Main) { for (ch in todoAsked) todos[ch] = emptyList() }
            }
        } else if (todoAsked.isNotEmpty()) pullTodos()
    }

    /** 立即按 GitHub 同步关联的 issue, 再增量拉。 */
    fun syncTodos(channel: String, done: () -> Unit = {}) = io {
        call(url(Constants.CHATS_API, channel, KEY_TODOS_SYNC), "POST", JSONObject())
        pullTodos()
        withContext(Dispatchers.Main) { done() }
    }

    private fun pullTodos(): Unit = io {
        todoLock.withLock {
            do {
                val r = call(url(Constants.PDATA_API, Constants.TODO_PLUGIN, Constants.TODO_COLL)?.newBuilder()?.addQueryParameter(Constants.QUERY_SINCE, todoRev.toString())?.build(), "GET", null) ?: return@withLock
                val items = r.optJSONArray("items") ?: JSONArray()
                // 服务端回收过墓碑或清除过数据: 这一页从头给, 本地副本先清空
                if (r.optBoolean("reset")) todoRows.clear()
                for (i in 0 until items.length()) {
                    val o = items.optJSONObject(i) ?: continue
                    if (o.optBoolean("deleted")) todoRows.remove(o.optString(KEY_ID)) else todoRows[o.optString(KEY_ID)] = o
                }
                todoRev = r.optLong("rev", todoRev)
            } while (r.optBoolean("more"))
            val all = todoRows.values.mapNotNull(::todoRow)
            val byGroup = all.groupBy({ it.first }, { it.second })
            // 本地闹钟按最新的待办重排 (到点提醒不靠长连)
            com.hengxin.aioa.link.TodoAlarms.sync(context, all.mapNotNull { com.hengxin.aioa.ui.todo.alarmPlan(it.second) })
            withContext(Dispatchers.Main) { for (ch in todoAsked) todos[ch] = if (ch == ALL_TODOS) all.map { it.second } else byGroup[ch].orEmpty() }
        }
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

    /** 写入用: 成功返回 null, 失败返回 (状态码, 服务端给的原因)。 */
    private fun callErr(url: HttpUrl?, method: String, body: JSONObject?): Pair<Int, String>? {
        val config = ConfigStore.load(context) ?: return 0 to "未配置服务端"
        val target = url ?: return 0 to "地址无效"
        val req = Request.Builder().url(target)
            .header("Authorization", "Bearer ${Auth.bearer(context, config)}")
            .method(method, body?.toString()?.toRequestBody(JSON_TYPE.toMediaType()))
            .build()
        return runCatching {
            Net.client(context).newCall(req).execute().use { res ->
                if (res.isSuccessful) null
                else res.code to (runCatching { JSONObject(res.body?.string().orEmpty()).optString("error") }.getOrNull()?.ifEmpty { null } ?: "HTTP ${res.code}")
            }
        }.getOrElse { 0 to (it.message ?: "网络错误") }
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
