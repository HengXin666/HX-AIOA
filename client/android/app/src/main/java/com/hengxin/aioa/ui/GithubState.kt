package com.hengxin.aioa.ui

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.hengxin.aioa.Constants
import com.hengxin.aioa.net.Api
import com.hengxin.aioa.net.ApiCache
import com.hengxin.aioa.proto.SourceRef
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

private const val GET = "GET"
// 一分钟内再进 GitHub 页不重复请求
private const val STALE_MS = 60_000L
private const val CACHE_REPOS = "gh-repos"
private const val POST = "POST"
private const val F_URL = "url"
private const val F_STATUS_CI = "ci"
private const val F_AT = "at"
private const val F_TITLE = "title"
private const val F_AUTHOR = "author"
private const val F_NUMBER = "number"
private const val F_STATUS = "status"
private const val F_BRANCH = "branch"
private const val F_WORKFLOW = "workflow"
private const val F_UPDATED = "updatedAt"
// webhook 常常一次推好几条, 合并成一次刷新
private const val EVENT_DEBOUNCE_MS = 1500L
// 服务端定时同步每 30 分钟一次, CI 显示运行中超过这么久就主动让它同步一次
private const val CI_STALE_MS = 3 * 60_000L
// 总览卡的动态取自最近活跃的几个仓库
private const val RECENT_REPOS = 3
const val GITHUB_RECENT_SHOWN = 3
private const val PREFS = "github"
private const val KEY_OFF = "plugin_off"
private const val HTTP_NOT_FOUND = 404
// 插件被停用或撤销: 入口立即隐藏
private val PLUGIN_OFF = setOf("disabled", "revoked")

enum class CiStatus { SUCCESS, FAILURE, RUNNING, CANCELLED, UNKNOWN }

data class GhPush(val at: Long, val by: String, val branch: String, val commits: Int)

data class GhCi(val status: CiStatus, val workflow: String, val branch: String, val url: String?, val at: Long)

data class GhRepo(
    val repo: String,
    val url: String,
    val description: String?,
    val stars: Int,
    val openPrs: Int,
    val openIssues: Int,
    val lastPush: GhPush?,
    val ci: GhCi?,
    val updatedAt: Long,
) {
    /** 最近一次活动时间, 用于排序。 */
    val active: Long get() = maxOf(updatedAt, lastPush?.at ?: 0L, ci?.at ?: 0L)
}

data class GhPr(val number: Int, val title: String, val author: String, val url: String, val draft: Boolean, val updatedAt: Long)

data class GhIssue(val number: Int, val title: String, val author: String, val url: String, val updatedAt: Long, val labels: List<String>)

data class GhRun(val workflow: String, val branch: String, val status: CiStatus, val url: String, val at: Long)

data class GhActivity(val ts: Long, val kind: String, val title: String, val url: String?, val repo: String)

/** 活跃分支: 最近一次推送与该分支最近的 CI 结果。 */
data class GhBranch(val name: String, val at: Long, val by: String, val commits: Int, val sha: String?, val ci: CiStatus?)

data class GhDetail(
    val repo: GhRepo, val prs: List<GhPr>, val issues: List<GhIssue>, val runs: List<GhRun>, val timeline: List<GhActivity>,
    val branches: List<GhBranch> = emptyList(),
)

/** GitHub 页的状态: 仓库列表, 详情缓存, 同步; 页面可见时收到 github 事件就刷新。 */
class GithubState(private val context: Context, private val scope: CoroutineScope) {
    var repos by mutableStateOf<List<GhRepo>>(emptyList())
        private set
    var loaded by mutableStateOf(false)
        private set
    var refreshing by mutableStateOf(false)
        private set
    var syncing by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    /** 服务端是否已经从 GitHub 回填过。 */
    var synced by mutableStateOf(true)
        private set
    var recent by mutableStateOf<List<GhActivity>>(emptyList())
        private set
    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    /** 主人启用了 GitHub 插件; 停用时服务端接口 404, 各处入口隐藏。记在本地, 下次打开先按上次的显示。 */
    var enabled by mutableStateOf(!prefs.getBoolean(KEY_OFF, false))
        private set
    val details = mutableStateMapOf<String, GhDetail>()
    val mine = GithubMine(context, scope)
    val branches = GithubBranches(context, scope)
    /** 从分支看板点进仓库时直接打开分支页, 详情页读完就清掉。 */
    var openBranchesTab = false
    val detailErrors = mutableStateMapOf<String, String>()

    // 正在显示的详情页仓库与可见页面数; 没人看时不因事件刷新
    private var openRepo: String? = null
    private var watchers = 0
    private var eventJob: Job? = null

    val openPrs: Int get() = repos.sumOf { it.openPrs }
    val openIssues: Int get() = repos.sumOf { it.openIssues }
    val ciFailures: Int get() = repos.count { it.ci?.status == CiStatus.FAILURE }
    val latestCi: GhCi? get() = repos.mapNotNull { it.ci }.maxByOrNull { it.at }

    private var lastRefresh = 0L

    /** 进页面时用: 刚刷过就不再请求, 返回上一页不会重新加载。 */
    fun refreshIfStale(withRecent: Boolean = false) {
        if (System.currentTimeMillis() - lastRefresh < STALE_MS) return
        refresh(withRecent)
    }

    fun refresh(withRecent: Boolean = false) {
        lastRefresh = System.currentTimeMillis()
        refreshing = true
        io {
            // 先显示上次的列表, 服务端有变化再替换
            var latest: List<GhRepo>? = null
            val err = ApiCache.get(context, CACHE_REPOS, listOf(Constants.GITHUB_REPOS_PATH), onCode = { code ->
                if (code != 0) scope.launch(Dispatchers.Main) { setEnabled(code != HTTP_NOT_FOUND) }
            }) { body, _ ->
                val list = body.optJSONArray("repos")?.let { objects(it).map(::repo) }?.sortedByDescending { it.active } ?: return@get
                latest = list
                withContext(Dispatchers.Main) {
                    repos = list
                    synced = body.optBoolean("synced", true)
                    loaded = true
                }
            }
            val recentList = latest?.takeIf { withRecent }?.let { loadRecent(it) }
            withContext(Dispatchers.Main) {
                refreshing = false
                loaded = true
                error = err
                recentList?.let { recent = it }
                syncIfCiStale()
            }
        }
    }

    fun loadDetail(name: String) = io {
        val (owner, repo) = name.split('/', limit = 2).let { it[0] to it.getOrElse(1) { "" } }
        val err = ApiCache.get(context, "gh-repo-" + name.replace('/', '_'), listOf(Constants.GITHUB_REPOS_PATH, owner, repo)) { body, _ ->
            val d = detail(body, name)
            withContext(Dispatchers.Main) {
                details[name] = d
                detailErrors.remove(name)
            }
        }
        if (err != null) withContext(Dispatchers.Main) { if (details[name] == null) detailErrors[name] = err }
    }

    /** 让服务端从 GitHub 回填, 完成后重新拉列表; 失败时把服务端的中文报错交给 onError。 */
    fun sync(onError: (String) -> Unit) {
        if (syncing) return
        syncing = true
        io {
            val r = Api.call(context, POST, listOf(Constants.GITHUB_SYNC_PATH), JSONObject())
            val fail = r.error ?: r.body?.optString("error")?.ifEmpty { null }
                ?: if (r.body?.optBoolean("ok", true) == false) "同步失败" else null
            withContext(Dispatchers.Main) {
                syncing = false
                if (fail != null) onError(fail) else {
                    refresh(withRecent = true)
                    openRepo?.let { loadDetail(it) }
                }
            }
        }
    }

    private var autoSyncAt = 0L

    // 运行中的 CI 早已结束但服务端还没同步到, 静默补一次; 有节流, 失败不提示
    private fun syncIfCiStale() {
        val now = System.currentTimeMillis()
        val stuck = repos.any { r -> r.ci?.let { it.status == CiStatus.RUNNING && now - it.at > CI_STALE_MS } == true }
        if (!stuck || now - autoSyncAt < CI_STALE_MS) return
        autoSyncAt = now
        sync { }
    }

    private fun setEnabled(on: Boolean) {
        if (enabled == on) return
        enabled = on
        prefs.edit().putBoolean(KEY_OFF, !on).apply()
    }

    /** 收到 hengxin666.github 的 plugin_update: 停用或撤销就隐藏, 否则重新拉一次 (成功即显示)。只在主线程调用。 */
    fun onPlugin(change: String) {
        if (change in PLUGIN_OFF) return setEnabled(false)
        refresh(withRecent = true)
    }

    /** 上次是停用状态时, 连上服务端问一次: 别的设备可能已经重新启用。 */
    fun probeIfOff() {
        if (!enabled) refresh()
    }

    /** 页面可见期间登记, 离开时注销; repo 非空表示详情页。 */
    fun attach(repo: String?) {
        watchers++
        if (repo != null) openRepo = repo
    }

    fun detach(repo: String?) {
        watchers = (watchers - 1).coerceAtLeast(0)
        if (repo != null && openRepo == repo) openRepo = null
    }

    /** 实时流里的事件。只在主线程调用。 */
    fun onEvent(source: SourceRef) {
        if (!isGithub(source) || watchers == 0) return
        eventJob?.cancel()
        eventJob = scope.launch {
            delay(EVENT_DEBOUNCE_MS)
            refresh(withRecent = true)
            openRepo?.let { loadDetail(it) }
        }
    }

    private fun isGithub(s: SourceRef): Boolean =
        s.type == Constants.SOURCE_GITHUB || s.id == Constants.SOURCE_GITHUB || s.icon == Constants.SOURCE_GITHUB

    private fun loadRecent(list: List<GhRepo>): List<GhActivity> {
        val found = list.take(RECENT_REPOS).mapNotNull { r ->
            val (owner, name) = r.repo.split('/', limit = 2).let { it[0] to it.getOrElse(1) { "" } }
            Api.call(context, GET, listOf(Constants.GITHUB_REPOS_PATH, owner, name)).body?.let { detail(it, r.repo) }
        }
        scope.launch(Dispatchers.Main) { found.forEach { details[it.repo.repo] = it } }
        return found.flatMap { it.timeline }.sortedByDescending { it.ts }.take(GITHUB_RECENT_SHOWN)
    }

    private fun detail(o: JSONObject, name: String): GhDetail {
        val summary = o.optJSONObject("repo")?.let(::repo) ?: repos.firstOrNull { it.repo == name } ?: GhRepo(name, "", null, 0, 0, 0, null, null, 0)
        return GhDetail(
            summary,
            arr(o, "prs").map { GhPr(it.optInt(F_NUMBER), it.optString(F_TITLE), it.optString(F_AUTHOR), it.optString(F_URL), it.optBoolean("draft"), it.optLong(F_UPDATED)) },
            arr(o, "issues").map {
                val labels = it.optJSONArray("labels")?.let { l -> (0 until l.length()).map { i -> l.optString(i) } }.orEmpty()
                GhIssue(it.optInt(F_NUMBER), it.optString(F_TITLE), it.optString(F_AUTHOR), it.optString(F_URL), it.optLong(F_UPDATED), labels)
            },
            arr(o, "runs").map { GhRun(it.optString(F_WORKFLOW), it.optString(F_BRANCH), ci(it.optString(F_STATUS)), it.optString(F_URL), it.optLong(F_AT)) },
            arr(o, "timeline").map { GhActivity(it.optLong("ts"), it.optString("kind"), it.optString(F_TITLE), opt(it, F_URL), name) },
            arr(o, "branches").map {
                GhBranch(it.optString(F_BRANCH), it.optLong(F_AT), it.optString("by"), it.optInt("commits"), opt(it, "sha"), opt(it, F_STATUS_CI)?.let(::ci))
            },
        )
    }

    private fun repo(o: JSONObject): GhRepo {
        val name = o.optString("repo")
        return GhRepo(
            name,
            o.optString(F_URL).ifEmpty { GH_WEB_ROOT + name },
            opt(o, "description"),
            o.optInt("stars"),
            o.optInt("openPrs"),
            o.optInt("openIssues"),
            o.optJSONObject("lastPush")?.let { GhPush(it.optLong(F_AT), it.optString("by"), it.optString(F_BRANCH), it.optInt("commits")) },
            o.optJSONObject("ci")?.let { GhCi(ci(it.optString(F_STATUS)), it.optString(F_WORKFLOW), it.optString(F_BRANCH), opt(it, F_URL), it.optLong(F_AT)) },
            o.optLong(F_UPDATED),
        )
    }

    private fun ci(s: String): CiStatus = runCatching { CiStatus.valueOf(s.uppercase()) }.getOrDefault(CiStatus.UNKNOWN)

    private fun opt(o: JSONObject, key: String): String? = if (o.isNull(key)) null else o.optString(key).ifEmpty { null }

    private fun arr(o: JSONObject, key: String): List<JSONObject> = o.optJSONArray(key)?.let(::objects).orEmpty()

    private fun objects(a: JSONArray): List<JSONObject> = (0 until a.length()).mapNotNull { a.optJSONObject(it) }

    private fun io(block: suspend () -> Unit) {
        scope.launch(Dispatchers.IO) {
            runCatching { block() }.onFailure {
                withContext(Dispatchers.Main) {
                    refreshing = false
                    syncing = false
                    loaded = true
                    error = "解析失败: ${it.message ?: it.javaClass.simpleName}"
                }
            }
        }
    }
}
