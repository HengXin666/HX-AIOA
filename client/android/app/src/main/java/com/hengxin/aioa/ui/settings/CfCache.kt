package com.hengxin.aioa.ui.settings

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import com.hengxin.aioa.net.Api
import com.hengxin.aioa.net.ApiCache
import com.hengxin.aioa.ui.PageCache
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/** body: 当前能显示的数据 (可能是上次的); error: 这次刷新失败的原因; stale: 显示的是旧数据。 */
class Cached(val body: JSONObject?, val error: String) {
    val stale get() = body != null && error.isNotEmpty()
}

/**
 * CF 各页的数据: 内存 → 本机磁盘 → 服务端。打开立刻显示上次的 (重启 App 后也有), 后台拿到新的再替换;
 * 刷新失败时保留旧数据, 只有一份都没有时才显示错误。
 */
@Composable
fun rememberCached(name: String, path: String, query: Map<String, String> = emptyMap(), reload: Int = 0): Cached {
    val context = LocalContext.current
    var body by remember(name) { mutableStateOf(PageCache.get<JSONObject>(name)) }
    var error by remember(name) { mutableStateOf("") }
    LaunchedEffect(name, reload) {
        if (body == null) withContext(Dispatchers.IO) { ApiCache.read(context, name) }?.let { body = it }
        val (fresh, err) = fetch(context, name, path, query)
        if (fresh != null) body = fresh
        error = err
    }
    return Cached(body, error)
}

/** 拉一次并写进两层缓存; 返回 (新数据, 错误)。 */
suspend fun fetch(context: Context, name: String, path: String, query: Map<String, String> = emptyMap()): Pair<JSONObject?, String> =
    withContext(Dispatchers.IO) {
        val r = Api.call(context, "GET", listOf(path), query = query)
        r.body?.let {
            PageCache.put(name, it)
            ApiCache.write(context, name, it)
        }
        r.body to r.error.orEmpty()
    }
