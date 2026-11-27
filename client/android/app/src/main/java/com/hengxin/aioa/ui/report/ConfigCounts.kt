package com.hengxin.aioa.ui.report

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.produceState
import androidx.compose.ui.platform.LocalContext
import com.hengxin.aioa.net.ApiCache
import com.hengxin.aioa.ui.ALL_TODOS
import com.hengxin.aioa.ui.ChatModel
import com.hengxin.aioa.ui.chat.Senders
import com.hengxin.aioa.ui.settings.PluginApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File

/** 周报 "我配置了多少" 的一格: value 为 null 表示本机还没有这项的缓存 (没打开过对应页面)。 */
data class ConfigCount(val label: String, val value: Int?, val note: String)

private const val CACHE_DIR = "api-cache"
private const val CACHE_INTEGRATIONS = "integrations"
private const val CF_ZONES = "cf-zones-"

/**
 * 配置计数 (#140): 空间, 群, Agent, 待办, 探针, 数据源, 系统发送者读内存里已有的状态;
 * 集成与 CF Zones 读本机接口缓存 (不发请求); 只有插件数在进页时问一次服务端。
 */
@Composable
fun rememberConfigCounts(chat: ChatModel, since: Long): List<ConfigCount> {
    val context = LocalContext.current
    val plugins = produceState<Pair<Int, Int>?>(null) {
        value = PluginApi(context).list().getOrNull()?.items?.let { list -> list.count { it.mine } to list.count { it.enabled } }
    }.value
    val cached = produceState<Pair<Int?, Int?>>(null to null) { value = withContext(Dispatchers.IO) { cachedCounts(context) } }.value
    val metas = chat.groups.directory.metas.values.filter { it.deleted == 0L }
    val agents = metas.flatMap { it.agents }
    val todos = chat.spaces.todos[ALL_TODOS].orEmpty()
    val hosts = chat.metrics.hosts
    val senders = Senders.list()
    return listOf(
        ConfigCount("空间", chat.spaces.spaces.size, "工作台与插件空间"),
        ConfigCount("插件", plugins?.first, plugins?.let { "启用 ${it.second}" } ?: "读取中"),
        ConfigCount("Agent", agents.size, "本周新加 ${agents.count { it.created >= since }}"),
        ConfigCount("待办", todos.size, "未完成 ${todos.count { !it.finished }}"),
        ConfigCount("探针", hosts.size, "在线 ${hosts.count { it.online }}"),
        ConfigCount("CF Zones", cached.second, if (cached.second == null) "打开过 CF 页后才有" else "来自上次查看"),
        ConfigCount("集成", cached.first, if (cached.first == null) "打开过接入页后才有" else "接入的 key"),
        ConfigCount("数据源", chat.sources.items.size, "GitHub 等"),
        ConfigCount("系统发送者", senders.size, "有头像 ${senders.count { it.avatar != null }}"),
        ConfigCount("群", metas.size, "置顶 ${metas.count { it.pinned }}"),
    )
}

/** 集成数与 CF Zone 数: 只读本机缓存, 没有就是 null。 */
private fun cachedCounts(context: Context): Pair<Int?, Int?> {
    val integrations = ApiCache.read(context, CACHE_INTEGRATIONS)?.optJSONArray("integrations")?.length()
    val zones = File(context.filesDir, CACHE_DIR).listFiles { f -> f.name.startsWith(CF_ZONES) }.orEmpty()
        .maxByOrNull { it.lastModified() }
        ?.let { f -> runCatching { JSONObject(f.readText()).optJSONObject("body")?.optJSONArray("zones")?.length() }.getOrNull() }
    return integrations to zones
}
