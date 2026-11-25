package com.hengxin.aioa.ui.settings

import android.content.Context
import com.hengxin.aioa.net.Api
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/** 对应协议 GhStatus 等: 授权情况, 仓库规则, Agent 开关, 操作记录。 */
data class GhAuth(val login: String, val kind: String, val since: Long, val expires: Long?)
data class GhRules(val pushedDays: Int? = null, val public: Boolean = false, val private: Boolean = false, val repos: List<String> = emptyList(), val deny: List<String> = emptyList())
data class GhRepo(val repo: String, val private: Boolean, val pushed: Long, val allowed: Boolean)
data class GhAgent(val keyId: String, val name: String, val channel: String, val allowed: Boolean, val dep: Boolean)
data class GhOp(val ts: Long, val by: String, val op: String, val repo: String, val issue: Int?, val ok: Boolean, val note: String?)
data class GhStatus(val auth: GhAuth?, val rules: GhRules, val device: Boolean, val agents: List<GhAgent>, val ops: List<GhOp>)
data class GhDevice(val id: String, val userCode: String, val verifyUrl: String, val expires: Long, val interval: Int)

/** 外部接入密钥 (待办插件): key 只在新建时给一次。 */
data class ExtKey(val id: String, val name: String, val access: String, val created: Long, val expires: Long?, val used: Long?)
data class ExtCreated(val info: ExtKey, val key: String, val mcp: String, val md: String)

/** GitHub 授权插件与外部接入的接口。 */
class GhApi(private val context: Context) {
    suspend fun status(): Result<GhStatus> = io { status(call(GET, listOf(GH))) }

    suspend fun setToken(token: String): Result<Unit> = io { call(PUT, listOf(GH, "token"), JSONObject().put("token", token)); Unit }

    suspend fun revoke(): Result<Unit> = io { call(DELETE, listOf(GH, "token")); Unit }

    suspend fun startDevice(): Result<GhDevice> = io {
        val b = call(POST, listOf(GH, "device"))
        GhDevice(b.optString("id"), b.optString("userCode"), b.optString("verifyUrl"), b.optLong("expires"), b.optInt("interval", DEFAULT_INTERVAL))
    }

    /** 返回 pending / done / expired / denied。 */
    suspend fun poll(id: String): Result<String> = io { call(POST, listOf(GH, "device", id)).optString("status") }

    suspend fun repos(fresh: Boolean): Result<List<GhRepo>> = io {
        val arr = call(GET, listOf(GH, "repos"), query = if (fresh) mapOf("fresh" to "1") else emptyMap()).optJSONArray("repos")
        objs(arr).map { GhRepo(it.optString("repo"), it.optBoolean("private"), it.optLong("pushed"), it.optBoolean("allowed")) }
    }

    suspend fun setRules(r: GhRules): Result<Unit> = io {
        val o = JSONObject().put("public", r.public).put("private", r.private).put("repos", JSONArray(r.repos)).put("deny", JSONArray(r.deny))
        r.pushedDays?.let { o.put("pushedDays", it) }
        call(PUT, listOf(GH, "rules"), o)
        Unit
    }

    suspend fun setAgent(keyId: String, on: Boolean): Result<Unit> = io { call(PUT, listOf(GH, "agents", keyId), JSONObject().put("allowed", on)); Unit }

    suspend fun extKeys(channel: String): Result<List<ExtKey>> = io { objs(call(GET, listOf(CHATS, channel, EXT)).optJSONArray("keys")).map(::ext) }

    suspend fun createExt(channel: String, name: String, write: Boolean, hours: Int): Result<ExtCreated> = io {
        val b = call(POST, listOf(CHATS, channel, EXT), JSONObject().put("name", name).put("access", if (write) "write" else "read").put("hours", hours))
        ExtCreated(ext(b.getJSONObject("info")), b.optString("key"), b.optString("mcp"), b.optString("md"))
    }

    suspend fun removeExt(channel: String, id: String): Result<Unit> = io { call(DELETE, listOf(CHATS, channel, EXT, id)); Unit }

    private fun status(b: JSONObject): GhStatus {
        val a = b.optJSONObject("auth")
        val r = b.optJSONObject("rules") ?: JSONObject()
        return GhStatus(
            auth = a?.let { GhAuth(it.optString("login"), it.optString("kind"), it.optLong("since"), it.optLong("expires").takeIf { e -> e > 0 }) },
            rules = GhRules(r.optInt("pushedDays").takeIf { it > 0 }, r.optBoolean("public"), r.optBoolean("private"), strs(r.optJSONArray("repos")), strs(r.optJSONArray("deny"))),
            device = b.optBoolean("device"),
            agents = objs(b.optJSONArray("agents")).map { GhAgent(it.optString("keyId"), it.optString("name"), it.optString("channel"), it.optBoolean("allowed"), it.optBoolean("dep")) },
            ops = objs(b.optJSONArray("ops")).map { GhOp(it.optLong("ts"), it.optString("by"), it.optString("op"), it.optString("repo"), it.optInt("issue").takeIf { n -> n > 0 }, it.optBoolean("ok"), it.optString("note").ifEmpty { null }) },
        )
    }

    private fun ext(o: JSONObject) = ExtKey(o.optString("id"), o.optString("name"), o.optString("access"), o.optLong("created"), o.optLong("expires").takeIf { it > 0 }, o.optLong("used").takeIf { it > 0 })

    private fun objs(a: JSONArray?) = (0 until (a?.length() ?: 0)).mapNotNull { a?.optJSONObject(it) }
    private fun strs(a: JSONArray?) = (0 until (a?.length() ?: 0)).mapNotNull { a?.optString(it)?.ifEmpty { null } }

    private fun call(method: String, path: List<String>, body: JSONObject? = null, query: Map<String, String> = emptyMap()): JSONObject {
        val r = Api.call(context, method, path, body, query)
        return r.body ?: error(r.error ?: FAILED)
    }

    private suspend fun <T> io(block: () -> T): Result<T> = withContext(Dispatchers.IO) { runCatching { block() } }

    companion object {
        private const val GH = "api/v1/gh"
        private const val CHATS = "api/v1/chats"
        private const val EXT = "todos-ext"
        private const val GET = "GET"
        private const val POST = "POST"
        private const val PUT = "PUT"
        private const val DELETE = "DELETE"
        private const val FAILED = "操作失败"
        private const val DEFAULT_INTERVAL = 5
    }
}
