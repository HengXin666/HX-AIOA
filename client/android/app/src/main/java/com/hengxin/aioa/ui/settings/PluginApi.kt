package com.hengxin.aioa.ui.settings

import android.content.Context
import com.hengxin.aioa.net.Api
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/** 已安装的实例: 群, 工作台, 当前版本, 自动更新开关 (缺省开)。 */
data class PluginInstall(val channel: String, val space: String?, val version: String, val installed: Long, val auto: Boolean)

/** 市场里的一项, 对应协议 PluginEntry + 本机安装状态。 */
data class PluginEntry(
    val id: String,
    val name: String,
    val summary: String,
    val version: String,
    val icon: String,
    val tags: List<String>,
    val author: String,
    val installed: PluginInstall?,
) {
    /** 市场有比已装更新的版本。 */
    val outdated get() = installed != null && installed.version != version
}

/** 详情: 介绍原文 (Markdown 或 HTML), 建议的定时, 任务提示词 (不含密钥)。 */
data class PluginDetail(val entry: PluginEntry, val readme: String, val html: Boolean, val schedule: String?, val task: String?)

/** 安装结果, 只给这一次: 本地 Agent 接入语 (含密钥), 云端 Agent 委托语 (不含密钥), 密钥本身。 */
data class PluginInstalled(val prompt: String, val request: String, val key: String)

/** 插件市场接口: 市场内容由服务端去仓库拉, App 只和自己的服务端说话。 */
class PluginApi(private val context: Context) {

    suspend fun list(): Result<Pair<List<PluginEntry>, String?>> = io {
        val r = Api.call(context, GET, listOf(PATH))
        val b = r.body ?: error(r.error ?: FAILED)
        val arr = b.optJSONArray("plugins")
        val list = (0 until (arr?.length() ?: 0)).mapNotNull { arr?.optJSONObject(it)?.let(::entry) }
        list to b.optString("error").ifEmpty { null }
    }

    suspend fun detail(id: String): Result<PluginDetail> = io {
        val r = Api.call(context, GET, listOf(PATH, id))
        val b = r.body ?: error(r.error ?: FAILED)
        val m = b.getJSONObject("manifest")
        val e = entry(m.put(KEY_INSTALLED, b.optJSONObject(KEY_INSTALLED) ?: JSONObject.NULL))
        PluginDetail(e, b.optString("readme"), b.optString("readmeType") == "html", m.optJSONObject("agent")?.optString("schedule")?.ifEmpty { null }, b.optString("task").ifEmpty { null })
    }

    suspend fun install(id: String): Result<PluginInstalled> = io {
        val r = Api.call(context, POST, listOf(PATH, id, "install"), JSONObject())
        val b = r.body ?: error(r.error ?: FAILED)
        PluginInstalled(b.optString("prompt"), b.optString("request"), b.optString("key"))
    }

    /** 手动更新到市场最新版; 版本相同也重新拉一遍模板。群, 密钥, 待办不变。 */
    suspend fun update(id: String): Result<Unit> = io {
        val r = Api.call(context, POST, listOf(PATH, id, "update"), JSONObject())
        if (r.body == null) error(r.error ?: FAILED)
    }

    suspend fun setAuto(id: String, on: Boolean): Result<Unit> = io {
        val r = Api.call(context, PATCH, listOf(PATH, id), JSONObject().put("auto", on))
        if (r.body == null) error(r.error ?: FAILED)
    }

    suspend fun uninstall(id: String): Result<Unit> = io {
        val r = Api.call(context, DELETE, listOf(PATH, id))
        if (r.body == null) error(r.error ?: FAILED)
    }

    private fun entry(o: JSONObject): PluginEntry {
        val tags = o.optJSONArray("tags")
        return PluginEntry(
            id = o.optString("id"),
            name = o.optString("name"),
            summary = o.optString("summary"),
            version = o.optString("version"),
            icon = o.optString("icon").ifEmpty { DEFAULT_ICON },
            tags = (0 until (tags?.length() ?: 0)).mapNotNull { tags?.optString(it)?.ifEmpty { null } },
            author = o.optString("author"),
            installed = o.optJSONObject(KEY_INSTALLED)?.let(::install),
        )
    }

    private fun install(o: JSONObject) = PluginInstall(o.optString("channel"), o.optString("space").ifEmpty { null }, o.optString("version"), o.optLong("installed"), o.optBoolean("auto", true))

    private suspend fun <T> io(block: () -> T): Result<T> = withContext(Dispatchers.IO) { runCatching(block) }

    companion object {
        const val DEFAULT_ICON = "puzzle"
        private const val PATH = "api/v1/plugins"
        private const val KEY_INSTALLED = "installed"
        private const val GET = "GET"
        private const val POST = "POST"
        private const val DELETE = "DELETE"
        private const val PATCH = "PATCH"
        private const val FAILED = "操作失败"
    }
}
