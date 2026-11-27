package com.hengxin.aioa.ui

import android.content.Context
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.Constants
import com.hengxin.aioa.kit.AnimatedItems
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.CardState
import com.hengxin.aioa.kit.Chip
import com.hengxin.aioa.kit.StateBody
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.net.Api
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

private const val GET = "GET"
private const val SEG_HISTORY = "history"
private const val SHA_SHORT = 7
private const val F_NUMBER = "number"

enum class HistKind(val key: String, val label: String, val icon: String) {
    COMMIT("commit", "提交", "git-commit-horizontal"),
    PR("pr", LABEL_PR, ICON_PR),
    ISSUE("issue", LABEL_ISSUE, ICON_ISSUE),
    RELEASE("release", "发布", "tag"),
}

data class GhHistItem(val id: String, val ts: Long, val title: String, val url: String?, val by: String?, val number: Int?, val state: String?)

data class GhHistPage(val items: List<GhHistItem>, val next: String?)

/** 一个 (仓库, 类别) 已翻到的历史; done 表示到了仓库的第一条。 */
data class GhHistList(val items: List<GhHistItem> = emptyList(), val next: String? = null, val done: Boolean = false, val loading: Boolean = false, val error: String? = null)

fun parseHistory(o: JSONObject): GhHistPage {
    val arr = o.optJSONArray("items")
    val items = (0 until (arr?.length() ?: 0)).mapNotNull { arr?.optJSONObject(it) }.map {
        GhHistItem(
            it.optString("id"), it.optLong("ts"), it.optString("title"), it.optString("url").ifEmpty { null }, it.optString("by").ifEmpty { null },
            if (it.has(F_NUMBER)) it.optInt(F_NUMBER) else null, it.optString("state").ifEmpty { null },
        )
    }
    return GhHistPage(items, if (o.isNull("next")) null else o.optString("next").ifEmpty { null })
}

/** 新的一页并到后面: 按 id 去重 (发布按页码翻, 有新发布时后一页会错位); 没有 next 或整页都重复就算到头。 */
fun mergeHistory(cur: GhHistList, page: GhHistPage): GhHistList {
    val seen = cur.items.mapTo(HashSet()) { it.id }
    val fresh = page.items.filter { seen.add(it.id) }
    val done = page.next == null || (page.items.isNotEmpty() && fresh.isEmpty())
    return cur.copy(items = cur.items + fresh, next = page.next, done = done, loading = false, error = null)
}

private fun stateLabel(s: String?): String = when (s) {
    "merged" -> "已合并"
    "closed" -> "已关闭"
    "open" -> "开放"
    else -> ""
}

fun histMeta(kind: HistKind, i: GhHistItem): String =
    metaOf(if (kind == HistKind.COMMIT) i.id.take(SHA_SHORT) else i.number?.let { "#$it" }.orEmpty(), stateLabel(i.state), i.by.orEmpty(), ago(i.ts))

/** 仓库全部历史 (#134): 按 (仓库, 类别) 分页往前翻, 游标是服务端给的 next; 只在内存里, 服务端按页缓存。 */
class GithubHistory(private val context: Context, private val scope: CoroutineScope) {
    private val lists = mutableStateMapOf<String, GhHistList>()

    private fun key(repo: String, kind: HistKind) = "$repo|${kind.key}"

    fun of(repo: String, kind: HistKind): GhHistList = lists[key(repo, kind)] ?: GhHistList()

    /** more = false 时从最新一页重来 (已有内容不清, 拿到后替换); more = true 时接着往前翻。只在主线程调用。 */
    fun load(repo: String, kind: HistKind, more: Boolean = false) {
        val k = key(repo, kind)
        val cur = lists[k] ?: GhHistList()
        if (cur.loading || (more && (cur.done || cur.next == null))) return
        lists[k] = cur.copy(loading = true, error = null)
        val before = if (more) cur.next else null
        scope.launch(Dispatchers.IO) {
            val (owner, name) = repo.split('/', limit = 2).let { it[0] to it.getOrElse(1) { "" } }
            val q = mapOf("kind" to kind.key) + (before?.let { mapOf("before" to it) } ?: emptyMap())
            val r = Api.call(context, GET, listOf(Constants.GITHUB_REPOS_PATH, owner, name, SEG_HISTORY), query = q)
            val page = r.body?.let { runCatching { parseHistory(it) }.getOrNull() }
            withContext(Dispatchers.Main) {
                val base = lists[k] ?: cur
                lists[k] = when {
                    page == null -> base.copy(loading = false, error = r.error ?: "解析失败")
                    more -> mergeHistory(base, page)
                    else -> mergeHistory(GhHistList(), page)
                }
            }
        }
    }
}

/** 仓库详情的 "历史" tab: 按类别切换, 点 "更早的" 一直往前翻到仓库的第一条。 */
@Composable
fun HistoryTab(h: GithubHistory, repo: String, open: (String?) -> Unit) {
    val c = Aioa.colors
    var kind by rememberSaveable(repo) { mutableStateOf(HistKind.COMMIT) }
    LaunchedEffect(repo, kind) { if (h.of(repo, kind).items.isEmpty()) h.load(repo, kind) }
    val list = h.of(repo, kind)
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            HistKind.entries.forEach { k -> Chip(k.label, k == kind) { kind = k } }
        }
        val shown = when {
            list.items.isNotEmpty() -> CardState.Ready
            list.error != null -> CardState.Error(list.error)
            list.done -> CardState.Empty
            else -> CardState.Loading
        }
        StateBody(shown, "没有${kind.label}", { h.load(repo, kind) }) {
            AnimatedItems(list.items, { it.id }) { i -> GhRow(kind.icon, i.title, histMeta(kind, i)) { open(i.url) } }
            when {
                list.loading -> Text("加载中...", c.textSecondary, GH_META_SP)
                list.error != null -> Chip("重试", false) { h.load(repo, kind, more = true) }
                !list.done -> Chip("更早的", false) { h.load(repo, kind, more = true) }
                else -> Text("已到最早一条, 共 ${list.items.size} 条", c.textSecondary, GH_META_SP)
            }
        }
    }
}
