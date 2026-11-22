package com.hengxin.aioa.config

import android.content.Context
import android.os.Build
import com.hengxin.aioa.Constants
import com.hengxin.aioa.net.Net
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile

/** 已登录的账号: 访问令牌 1 小时, 刷新令牌每次刷新都会换新。 */
data class AuthSession(
    val name: String,
    val display: String,
    val role: String,
    val session: String,
    val access: String,
    val accessExp: Long,
    val refresh: String,
)

/** 登录或刷新的结果: 成功带会话, 失败带服务端的中文原因。 */
class AuthReply(val session: AuthSession?, val error: String?)

// 账号会话存在文件里, 界面进程与 :link 进程共用; 刷新时加文件锁, 避免两个进程同时轮换刷新令牌把对方挤掉
object Auth {
    private const val FILE_NAME = "session.json"
    private const val LOCK_NAME = "session.lock"
    private const val JSON_TYPE = "application/json"
    // 提前 2 分钟刷新, 留出时钟误差与网络耗时
    private const val EARLY_MS = 120_000L
    private const val K_NAME = "name"
    private const val K_DISPLAY = "display"
    private const val K_ROLE = "role"
    private const val K_SESSION = "session"
    private const val K_ACCESS = "access"
    private const val K_EXP = "accessExp"
    private const val K_REFRESH = "refresh"
    private const val K_USER = "user"
    private const val K_ERROR = "error"
    private const val HTTP_UNAUTHORIZED = 401
    private val jvmLock = Any()

    fun load(context: Context): AuthSession? = JsonFile.read(file(context))?.let {
        AuthSession(
            it.optString(K_NAME), it.optString(K_DISPLAY), it.optString(K_ROLE), it.optString(K_SESSION),
            it.optString(K_ACCESS), it.optLong(K_EXP), it.optString(K_REFRESH),
        )
    }?.takeIf { it.refresh.isNotEmpty() }

    fun signedIn(context: Context): Boolean = load(context) != null

    fun clear(context: Context) {
        file(context).delete()
    }

    /** 请求要带的凭证: 账号的访问令牌 (快过期时先刷新), 未登录为空。只能在后台线程调用。 */
    fun bearer(context: Context, config: AppConfig): String {
        if (load(context) == null) return ""
        return locked(context) {
            val s = load(context) ?: return@locked null
            if (s.accessExp - EARLY_MS > System.currentTimeMillis()) return@locked s.access
            val r = post(context, config.server, Constants.AUTH_REFRESH_PATH, JSONObject().put(K_REFRESH, s.refresh))
            when {
                r.session != null -> r.session.access
                // 刷新令牌已失效 (被踢, 改密码, 过期): 退出登录
                r.error == UNAUTHORIZED -> { clear(context); null }
                else -> s.access
            }
        } ?: ""
    }

    /** 账号密码登录, 成功后写入会话。只能在后台线程调用。 */
    fun login(context: Context, server: String, name: String, password: String): AuthReply {
        val device = JSONObject().put("name", "${Build.MANUFACTURER} ${Build.MODEL}".trim()).put("platform", "android")
        val body = JSONObject().put(K_NAME, name.trim()).put("password", password).put("device", device)
        return locked(context) { post(context, server, Constants.AUTH_LOGIN_PATH, body) }
    }

    /** 退出: 先吊销服务端会话, 网络失败也清本地。只能在后台线程调用。 */
    fun logout(context: Context, config: AppConfig) {
        val s = load(context) ?: return
        runCatching { call(context, config.server, Constants.AUTH_LOGOUT_PATH, JSONObject(), "Bearer ${bearer(context, config)}") }
        if (load(context)?.session == s.session) clear(context)
    }

    private const val UNAUTHORIZED = "unauthorized"

    private fun post(context: Context, server: String, path: String, body: JSONObject): AuthReply {
        val (code, json) = runCatching { call(context, server, path, body, null) }
            .getOrElse { return AuthReply(null, "网络错误: ${it.message ?: it.javaClass.simpleName}") }
        if (code == HTTP_UNAUTHORIZED && path == Constants.AUTH_REFRESH_PATH) return AuthReply(null, UNAUTHORIZED)
        if (code !in 200..299 || json == null) return AuthReply(null, json?.optString(K_ERROR)?.ifEmpty { null } ?: "请求失败 (HTTP $code)")
        val user = json.optJSONObject(K_USER) ?: JSONObject()
        val s = AuthSession(
            user.optString(K_NAME), user.optString(K_DISPLAY), user.optString(K_ROLE), json.optString(K_SESSION),
            json.optString(K_ACCESS), System.currentTimeMillis() + json.optLong("expiresIn") * 1000, json.optString(K_REFRESH),
        )
        save(context, s)
        return AuthReply(s, null)
    }

    private fun call(context: Context, server: String, path: String, body: JSONObject, auth: String?): Pair<Int, JSONObject?> {
        val url = server.trim().toHttpUrl().newBuilder().addPathSegments(path).build()
        val req = Request.Builder().url(url).post(body.toString().toRequestBody(JSON_TYPE.toMediaType()))
        if (auth != null) req.header("Authorization", auth)
        return Net.client(context).newCall(req.build()).execute().use { res ->
            res.code to runCatching { JSONObject(res.body?.string().orEmpty()) }.getOrNull()
        }
    }

    private fun save(context: Context, s: AuthSession) = JsonFile.write(
        file(context),
        JSONObject().put(K_NAME, s.name).put(K_DISPLAY, s.display).put(K_ROLE, s.role).put(K_SESSION, s.session)
            .put(K_ACCESS, s.access).put(K_EXP, s.accessExp).put(K_REFRESH, s.refresh),
    )

    private fun <T> locked(context: Context, block: () -> T): T = synchronized(jvmLock) {
        RandomAccessFile(File(context.filesDir, LOCK_NAME), "rw").use { raf -> raf.channel.lock().use { block() } }
    }

    private fun file(context: Context) = File(context.filesDir, FILE_NAME)
}
