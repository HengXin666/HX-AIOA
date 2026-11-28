package com.hengxin.aioa.ui.hxoa

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.pressable
import com.hengxin.aioa.net.Api
import com.hengxin.aioa.net.ApiCache
import com.hengxin.aioa.ui.PageCache
import com.hengxin.aioa.ui.settings.PluginEvents
import com.hengxin.aioa.ui.settings.fetch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

// hxoa 的全屏页 (#142): 一层全屏窗口 + 页面栈 (列表 → 一台 → 工作区 / 添加工作区), 返回键逐级退;
// 以前每级各开一个全屏 Dialog 叠起来 (ui-spec 标了 "改成子页")。入口: "工作区" 页 (agent harness, #144) 的 hxoa 分组, 侧栏 "hxoa"。

private const val HTTP_FORBIDDEN = 403
private const val HTTP_NOT_FOUND = 404
// 一台的状态多久内不重拉 (进出工作区, 添加工作区页都用这份)
private const val STATE_FRESH_MS = 30_000L

/** 页面栈里的一页。 */
sealed interface HxoaRoute {
    data object List : HxoaRoute
    data class Conn(val id: String) : HxoaRoute
    data class Ws(val conn: String, val ws: String) : HxoaRoute
    data class Pick(val conn: String) : HxoaRoute
}

/** hxoa 页面栈与 "数据变了" 计数; 栈空时不显示。 */
object HxoaNav {
    var stack by mutableStateOf<kotlin.collections.List<HxoaRoute>>(emptyList())
        private set
    var reload by mutableIntStateOf(0)
        private set

    fun openList() = open(HxoaRoute.List)

    /** 从外面打开: 栈只有这一页, 返回就回到原来的页面。 */
    fun open(r: HxoaRoute) {
        stack = listOf(r)
    }

    fun push(r: HxoaRoute) {
        stack = stack + r
    }

    fun back() {
        stack = stack.dropLast(1)
    }

    fun changed() {
        reload++
    }

    // 每台的状态上次拉到时的 (reload, 时刻)
    private val fetchedAt = HashMap<String, Pair<Int, Long>>()

    internal fun fetched(conn: String) {
        fetchedAt[conn] = reload to System.currentTimeMillis()
    }

    internal fun stale(conn: String): Boolean {
        val (r, at) = fetchedAt[conn] ?: return true
        return r != reload || System.currentTimeMillis() - at > STATE_FRESH_MS
    }
}

/**
 * 主人是否启用了 hxoa 插件 (hengxin666.hxoa, 换到私有源后 id 不变, 服务端只看主人的启用): 以接口为准,
 * 404 (没启用 / 没放行) 与 403 (子号) 都算没有。记在本地, 下次打开先按上次的显示; null 是还没问过。
 */
object HxoaGate {
    private const val PREFS = "hxoa"
    private const val KEY_ON = "on"
    var on by mutableStateOf<Boolean?>(null)
        private set
    private var loaded = false

    fun load(context: Context) {
        if (loaded) return
        loaded = true
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        on = if (p.contains(KEY_ON)) p.getBoolean(KEY_ON, false) else null
    }

    fun set(context: Context, value: Boolean) {
        if (on == value) return
        on = value
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_ON, value).apply()
    }

    /** 问一次接入列表: 成功即启用并写缓存, 404 / 403 即没启用, 其它错误 (断网) 不动状态; 返回错误文字。 */
    suspend fun probe(context: Context): String {
        load(context)
        val r = withContext(Dispatchers.IO) { Api.call(context, "GET", listOf(HXOA_PATH)) }
        val body = r.body
        return when {
            body != null -> {
                withContext(Dispatchers.IO) { ApiCache.write(context, CACHE_CONNS, body) }
                PageCache.put(CACHE_CONNS, body)
                set(context, true)
                ""
            }
            r.code == HTTP_NOT_FOUND || r.code == HTTP_FORBIDDEN -> { set(context, false); "" }
            else -> r.error.orEmpty()
        }
    }
}

internal class ConnsView(val list: kotlin.collections.List<HxoaConn>?, val error: String)

/** 接入列表: 先显示缓存, 进来与数据变了 / 插件变了 (plugin_update) 时刷新; 没启用时 list 为 null。 */
@Composable
internal fun rememberConns(): ConnsView {
    val context = LocalContext.current.applicationContext
    var body by remember { mutableStateOf(PageCache.get<JSONObject>(CACHE_CONNS)) }
    var error by remember { mutableStateOf("") }
    val plugins by PluginEvents.rev.collectAsState()
    LaunchedEffect(HxoaNav.reload, plugins) {
        if (body == null) withContext(Dispatchers.IO) { ApiCache.read(context, CACHE_CONNS) }?.let { body = it; PageCache.put(CACHE_CONNS, it) }
        error = HxoaGate.probe(context)
        PageCache.get<JSONObject>(CACHE_CONNS)?.let { body = it }
    }
    return ConnsView(if (HxoaGate.on == false) null else body?.let(::parseConns), error)
}

/** 一台的状态: 缓存先显示; 没拉过, 数据变了, 或上次拉的超过 [STATE_FRESH_MS] 才拉 (进出工作区不重复请求)。 */
@Composable
private fun rememberConnState(conn: String): Pair<HxoaState?, String> {
    val context = LocalContext.current.applicationContext
    val name = cacheState(conn)
    var body by remember(conn) { mutableStateOf(PageCache.get<JSONObject>(name)) }
    var error by remember(conn) { mutableStateOf("") }
    LaunchedEffect(conn, HxoaNav.reload) {
        if (body == null) withContext(Dispatchers.IO) { ApiCache.read(context, name) }?.let { body = it }
        if (body != null && !HxoaNav.stale(conn)) return@LaunchedEffect
        val (fresh, err) = fetch(context, name, "$HXOA_PATH/$conn/state")
        if (fresh != null) {
            body = fresh
            HxoaNav.fetched(conn)
        }
        error = err
    }
    return body?.let(::parseState) to error
}

/** hxoa 的全屏窗口; 栈空时什么也不画。只在一处挂 ("工作区" 页的 [HxoaSection])。 */
@Composable
fun HxoaHost() {
    val top = HxoaNav.stack.lastOrNull() ?: return
    val api = HxoaApi(LocalContext.current.applicationContext)
    Dialog(HxoaNav::back, DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Box(Modifier.fillMaxSize().background(Aioa.colors.background).systemBarsPadding().imePadding()) {
            when (top) {
                HxoaRoute.List -> ListPage(api)
                is HxoaRoute.Conn -> ConnPage(api, top.id)
                is HxoaRoute.Ws -> {
                    val ws = rememberConnState(top.conn).first?.workspaces?.firstOrNull { it.id == top.ws }
                    if (ws != null) WorkspacePage(api, top.conn, ws, HxoaNav::back, HxoaNav::changed)
                    else LaunchedEffect(top) { HxoaNav.back() }
                }
                is HxoaRoute.Pick -> {
                    val paths = rememberConnState(top.conn).first?.workspaces?.map { it.path }.orEmpty()
                    AddWorkspacePage(api, top.conn, paths, HxoaNav::back) { HxoaNav.back(); HxoaNav.changed() }
                }
            }
        }
    }
}

/** 全部 hxoa: 每台的在线状态与版本, 右上角接入新的。 */
@Composable
private fun ListPage(api: HxoaApi) {
    val c = Aioa.colors
    val view = rememberConns()
    var adding by remember { mutableStateOf(false) }
    val list = view.list.orEmpty()
    FullPage(HxoaNav::back, "hxoa", if (list.isEmpty()) "未接入" else "${list.count { it.online }}/${list.size} 在线", "plus" to { adding = true }) {
        if (view.error.isNotEmpty()) Text(view.error, c.textSecondary, 12, Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
        LazyColumn(Modifier.weight(1f).fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            itemsIndexed(list, key = { _, k -> k.id }) { i, conn ->
                Stagger(i) {
                    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(c.surface).pressable { HxoaNav.push(HxoaRoute.Conn(conn.id)) }.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        StatusDot(conn)
                        Spacer(Modifier.width(8.dp))
                        androidx.compose.foundation.layout.Column(Modifier.weight(1f)) {
                            Text(conn.name, c.text, 14)
                            Text(conn.base, c.textSecondary, 12)
                        }
                        Text(connHint(conn), c.textSecondary, 12)
                        Icon("chevron-right", c.textSecondary, 16.dp)
                    }
                }
            }
            if (view.list != null && list.isEmpty()) item { Text("还没有接入 hxoa。点右上角 + , 填地址与管理令牌。", c.textSecondary, 13, Modifier.padding(8.dp)) }
        }
    }
    if (adding) AddConnDialog(api, { adding = false }) { adding = false; HxoaNav.changed() }
}

/** 一台 hxoa: 工作区列表 (先显示缓存), 点开详情, 右上角删接入, 底部添加工作区。 */
@Composable
private fun ConnPage(api: HxoaApi, id: String) {
    val c = Aioa.colors
    val scope = rememberCoroutineScope()
    // 接入列表由 "工作区" 页的分组或列表页拉好放在缓存里, 这里只读不再请求
    val conns = remember(HxoaNav.reload) { PageCache.get<JSONObject>(CACHE_CONNS)?.let(::parseConns) }
    val conn = conns?.firstOrNull { it.id == id }
    if (conn == null || HxoaGate.on == false) {
        // 被删了 (别的设备) 或插件停用: 退回去
        LaunchedEffect(id) { HxoaNav.back() }
        return
    }
    val (state, loadErr) = if (conn.legacy) null to "" else rememberConnState(id)
    var removing by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf<String?>(null) }
    val sub = state?.let { listOfNotNull(it.server, it.publicUrl.ifEmpty { null }, it.tunnel).joinToString(" · ") } ?: (conn.error ?: conn.base)
    FullPage(HxoaNav::back, conn.name, sub, "trash-2" to { removing = true }) {
        val shown = err ?: conn.error?.takeIf { conn.legacy } ?: loadErr.ifEmpty { null }
        shown?.let { Text(it, if (state != null) c.textSecondary else c.danger, 12, Modifier.padding(horizontal = 16.dp, vertical = 6.dp)) }
        LazyColumn(Modifier.weight(1f).fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            itemsIndexed(state?.workspaces.orEmpty(), key = { _, w -> w.id }) { i, w -> Stagger(i) { WsRow(w) { HxoaNav.push(HxoaRoute.Ws(id, w.id)) } } }
            if (state != null && state.workspaces.isEmpty()) item { Text("还没有工作区", c.textSecondary, 13, Modifier.padding(8.dp)) }
            if (state == null && loadErr.isEmpty() && !conn.legacy) item { Text("加载中...", c.textSecondary, 13, Modifier.padding(8.dp)) }
            if (!conn.legacy) item {
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).pressable { HxoaNav.push(HxoaRoute.Pick(id)) }.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon("plus", c.accent, 18.dp)
                    Spacer(Modifier.width(8.dp))
                    Text("添加工作区", c.accent, 14)
                }
            }
        }
    }
    if (removing) AlertDialog(
        onDismissRequest = { removing = false },
        title = { androidx.compose.material3.Text("删掉这条接入?") },
        text = { androidx.compose.material3.Text("只删 AIOA 这边的记录; 要让管理令牌失效, 去 hxoa 面板 远程管理 删。") },
        confirmButton = {
            TextButton({
                removing = false
                scope.launch { runCatching { api.remove(id) }.onSuccess { HxoaNav.back(); HxoaNav.changed() }.onFailure { err = it.message } }
            }) { androidx.compose.material3.Text("删除", color = c.danger) }
        },
        dismissButton = { TextButton({ removing = false }) { androidx.compose.material3.Text("取消") } },
    )
}
