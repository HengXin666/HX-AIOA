package com.hengxin.aioa.ui

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.hengxin.aioa.Constants
import com.hengxin.aioa.net.ApiCache
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

private const val CACHE_BRANCHES = "gh-branches"
private const val STALE_MS = 60_000L
private const val DAY_MS = 86_400_000L
// 新鲜度分档: 3 天内 / 14 天内 / 更久
const val FRESH_DAYS = 3
const val AGING_DAYS = 14

/** 未合入分支: ahead = 分支独有提交, behind = 落后默认分支多少。 */
data class GhOpenBranch(
    val name: String, val at: Long, val by: String, val ahead: Int, val behind: Int, val url: String,
    val pr: Int?, val prUrl: String?, val ci: CiStatus?,
)

data class GhRepoBranches(val repo: String, val url: String, val base: String, val branches: List<GhOpenBranch>, val error: String?)

enum class Freshness { FRESH, AGING, STALE }

fun freshnessOf(at: Long, now: Long = System.currentTimeMillis()): Freshness = when {
    now - at < FRESH_DAYS * DAY_MS -> Freshness.FRESH
    now - at < AGING_DAYS * DAY_MS -> Freshness.AGING
    else -> Freshness.STALE
}

/** 关注仓库的未合入分支, 服务端缓存 10 分钟; 下拉刷新带 fresh=1。 */
class GithubBranches(private val context: Context, private val scope: CoroutineScope) {
    var repos by mutableStateOf<List<GhRepoBranches>>(emptyList())
        private set
    var loaded by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    private var loadedAt = 0L

    val total: Int get() = repos.sumOf { it.branches.size }
    val all: List<GhOpenBranch> get() = repos.flatMap { it.branches }

    fun of(repo: String): GhRepoBranches? = repos.firstOrNull { it.repo.equals(repo, ignoreCase = true) }

    fun refreshIfStale() {
        if (System.currentTimeMillis() - loadedAt < STALE_MS) return
        load(false)
    }

    fun load(fresh: Boolean) {
        loadedAt = System.currentTimeMillis()
        scope.launch(Dispatchers.IO) {
            val q = if (fresh) mapOf("fresh" to "1") else emptyMap()
            val err = runCatching {
                ApiCache.get(context, CACHE_BRANCHES, listOf(Constants.GITHUB_BRANCHES_PATH), q) { o, _ ->
                    val list = objects(o.optJSONArray("repos")).map(::repoOf)
                    withContext(Dispatchers.Main) { repos = list; loaded = true }
                }
            }.getOrElse { "解析失败: ${it.message ?: it.javaClass.simpleName}" }
            withContext(Dispatchers.Main) { error = err; loaded = true }
        }
    }

    private fun repoOf(o: JSONObject) = GhRepoBranches(
        o.optString("repo"), o.optString("url"), o.optString("defaultBranch"),
        objects(o.optJSONArray("branches")).map(::branchOf), o.optString("error").ifEmpty { null },
    )

    private fun branchOf(o: JSONObject): GhOpenBranch {
        val pr = o.optJSONObject("pr")
        val ci = o.optString("ci").ifEmpty { null }?.let { s -> runCatching { CiStatus.valueOf(s.uppercase()) }.getOrNull() }
        return GhOpenBranch(
            o.optString("name"), o.optLong("at"), o.optString("by"), o.optInt("ahead"), o.optInt("behind"), o.optString("url"),
            pr?.optInt("number"), pr?.optString("url")?.ifEmpty { null }, ci,
        )
    }

    private fun objects(a: JSONArray?): List<JSONObject> = (0 until (a?.length() ?: 0)).mapNotNull { a?.optJSONObject(it) }
}
