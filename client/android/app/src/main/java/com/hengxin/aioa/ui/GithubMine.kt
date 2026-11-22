package com.hengxin.aioa.ui

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
import java.util.Calendar

data class GhPick(val repo: String, val private: Boolean, val description: String?, val pushedAt: Long, val tracked: Boolean)

data class GhMineItem(val id: String, val ts: Long, val kind: String, val repo: String, val title: String, val url: String?)

data class GhMineStats(val pushes: Int, val commits: Int, val prs: Int, val issues: Int, val comments: Int, val repos: Int)

data class GhToday(val login: String, val items: List<GhMineItem>, val stats: GhMineStats)

/** 我的 GitHub: 今天的个人动态, 以及从账号下的仓库里勾选要显示的。 */
class GithubMine(private val context: Context, private val scope: CoroutineScope) {
    var today by mutableStateOf<GhToday?>(null)
        private set
    var picks by mutableStateOf<List<GhPick>>(emptyList())
        private set
    var login by mutableStateOf("")
        private set
    var loadingPicks by mutableStateOf(false)
        private set
    var saving by mutableStateOf(false)
        private set
    var pickError by mutableStateOf<String?>(null)
        private set

    /** 按本机时区取今天零点之后的动态。 */
    fun loadToday() = io {
        val since = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
        }.timeInMillis
        val r = Api.call(context, GET, listOf(Constants.GITHUB_ACTIVITY_PATH), query = mapOf("since" to since.toString()))
        val o = r.body ?: return@io
        val st = o.optJSONObject("stats") ?: JSONObject()
        val t = GhToday(
            o.optString("login"),
            objects(o.optJSONArray("items")).map {
                GhMineItem(it.optString("id"), it.optLong("ts"), it.optString("kind"), it.optString("repo"), it.optString("title"), it.optString("url").ifEmpty { null })
            },
            GhMineStats(st.optInt("pushes"), st.optInt("commits"), st.optInt("prs"), st.optInt("issues"), st.optInt("comments"), st.optInt("repos")),
        )
        withContext(Dispatchers.Main) { today = t }
    }

    fun loadPicks() {
        loadingPicks = true
        pickError = null
        io {
            val r = Api.call(context, GET, listOf(Constants.GITHUB_AVAILABLE_PATH))
            val list = objects(r.body?.optJSONArray("repos")).map {
                GhPick(it.optString("repo"), it.optBoolean("private"), it.optString("description").ifEmpty { null }, it.optLong("pushedAt"), it.optBoolean("tracked"))
            }
            withContext(Dispatchers.Main) {
                loadingPicks = false
                pickError = r.error
                if (r.body != null) {
                    picks = list
                    login = r.body.optString("login")
                }
            }
        }
    }

    /** 保存勾选结果 (整体替换), 成功后让 GitHub 页重拉列表并回填。 */
    fun save(selected: Set<String>, done: (String?) -> Unit) {
        if (saving) return
        saving = true
        io {
            val body = JSONObject().put("repos", JSONArray(selected.toList()))
            val r = Api.call(context, PUT, listOf(Constants.GITHUB_TRACKED_PATH), body)
            withContext(Dispatchers.Main) {
                saving = false
                if (r.error == null) picks = picks.map { it.copy(tracked = it.repo in selected) }
                done(r.error)
            }
        }
    }

    private fun objects(a: JSONArray?): List<JSONObject> = (0 until (a?.length() ?: 0)).mapNotNull { a?.optJSONObject(it) }

    private fun io(block: suspend () -> Unit) {
        scope.launch(Dispatchers.IO) {
            runCatching { block() }.onFailure {
                withContext(Dispatchers.Main) {
                    loadingPicks = false
                    saving = false
                    pickError = "解析失败: ${it.message ?: it.javaClass.simpleName}"
                }
            }
        }
    }

    private companion object {
        const val GET = "GET"
        const val PUT = "PUT"
    }
}
