package com.hengxin.aioa.ui.hxoa

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import com.hengxin.aioa.net.Api
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

// hxoa 管理 (内置插件 hengxin666.hxoa, #104) 的数据与接口。接口见 docs/api/hxoa.md

internal const val HXOA_PATH = "api/v1/hxoa"
// 本机两层缓存的键: 接入列表, 每台的状态
internal const val CACHE_CONNS = "hxoa:conns"
internal fun cacheState(id: String) = "hxoa:state:$id"
private const val GET = "GET"
private const val POST = "POST"
private const val PATCH = "PATCH"
private const val DELETE = "DELETE"
private const val CLIP_LABEL = "hxoa"

data class HxoaConn(val id: String, val name: String, val base: String, val server: String?, val publicUrl: String?, val error: String?, val legacy: Boolean) {
    val online get() = server != null
}
data class HxoaToken(val id: String, val label: String, val online: Boolean, val lastSeen: String?, val ops: Long, val branch: String?, val ahead: String?, val dirty: Int)
data class HxoaWs(val id: String, val name: String, val path: String, val workers: Boolean, val exec: Boolean, val git: Boolean, val branch: String?, val online: Int, val tokens: List<HxoaToken>)
data class HxoaState(val server: String, val publicUrl: String, val tunnel: String?, val workspaces: List<HxoaWs>)
data class HxoaDir(val path: String, val parent: String, val dirs: List<String>, val git: Boolean)

private fun JSONObject.s(k: String) = optString(k).ifEmpty { null }
private fun <T> JSONArray?.map(f: (JSONObject) -> T): List<T> = if (this == null) emptyList() else (0 until length()).map { f(getJSONObject(it)) }

internal fun parseConns(b: JSONObject): List<HxoaConn> = b.optJSONArray("conns").map { o ->
    val h = o.optJSONObject("hello")
    HxoaConn(o.optString("id"), o.optString("name"), o.optString("base"), h?.s("server"), h?.s("publicUrl"), o.s("error"), o.optString("kind") == "agent")
}

internal fun parseState(b: JSONObject): HxoaState {
    val tun = b.optJSONObject("tunnel")
    val ws = b.optJSONArray("workspaces").map { w ->
        val tokens = w.optJSONArray("tokens").map { t ->
            val wk = t.optJSONObject("worker")
            HxoaToken(t.optString("id"), t.optString("label"), t.optBoolean("online"), t.s("lastSeen"), t.optLong("ops"), wk?.s("branch"), wk?.s("ahead"), wk?.optJSONArray("dirty")?.length() ?: 0)
        }
        HxoaWs(w.optString("id"), w.optString("name"), w.optString("path"), w.optBoolean("workers"), w.optBoolean("exec"), w.optBoolean("git"), w.s("branch"), w.optInt("online"), tokens)
    }
    return HxoaState(b.optString("server"), b.optString("publicUrl"), tun?.let { listOfNotNull(it.s("mode"), it.s("state")).joinToString(" · ") }, ws)
}

/** 服务端接口; 只能在协程里调, 自己切到 IO; 失败抛 IllegalStateException, message 是给人看的原因。 */
internal class HxoaApi(private val context: Context) {
    private suspend fun call(method: String, segs: List<String>, body: JSONObject? = null, query: Map<String, String> = emptyMap()): JSONObject = withContext(Dispatchers.IO) {
        val r = Api.call(context, method, listOf(HXOA_PATH) + segs, body, query)
        r.body ?: error(r.error ?: "请求失败")
    }

    suspend fun add(name: String, base: String, token: String) {
        call(POST, emptyList(), JSONObject().put("name", name).put("base", base).put("token", token))
    }

    suspend fun remove(id: String) {
        call(DELETE, listOf(id))
    }

    suspend fun browse(id: String, path: String): HxoaDir {
        val b = call(GET, listOf(id, "browse"), query = mapOf("path" to path))
        val a = b.optJSONArray("dirs")
        return HxoaDir(b.optString("path"), b.optString("parent"), (0 until (a?.length() ?: 0)).map { a!!.getString(it) }, b.optBoolean("git"))
    }

    /** 在 parent 下新建一个文件夹, 返回它的完整路径。 */
    suspend fun mkdir(id: String, parent: String, name: String): String = call(POST, listOf(id, "mkdir"), JSONObject().put("parent", parent).put("name", name)).optString("path")

    suspend fun addWorkspace(id: String, name: String, path: String, workers: Boolean, exec: Boolean) {
        call(POST, listOf(id, "workspaces"), JSONObject().put("name", name).put("path", path).put("workers", workers).put("exec", exec))
    }

    suspend fun patchWorkspace(id: String, ws: String, patch: JSONObject) {
        call(PATCH, listOf(id, "workspaces", ws), patch)
    }

    suspend fun deleteWorkspace(id: String, ws: String) {
        call(DELETE, listOf(id, "workspaces", ws))
    }

    /** 新建连接令牌, 返回连接提示。 */
    suspend fun addToken(id: String, ws: String, label: String): String = call(POST, listOf(id, "workspaces", ws, "tokens"), JSONObject().put("label", label)).optString("prompt")

    suspend fun prompt(id: String, tok: String): String = call(GET, listOf(id, "tokens", tok, "prompt")).optString("prompt")

    suspend fun merge(id: String, tok: String): String = call(POST, listOf(id, "tokens", tok, "merge")).optString("output")

    suspend fun deleteToken(id: String, tok: String) {
        call(DELETE, listOf(id, "tokens", tok))
    }
}

internal fun copyText(context: Context, text: String) {
    context.getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText(CLIP_LABEL, text))
}
