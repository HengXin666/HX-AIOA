package com.hengxin.aioa.ui.drive

import android.content.Context
import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.HxButton
import com.hengxin.aioa.kit.HxButtonSize
import com.hengxin.aioa.kit.HxButtonVariant
import com.hengxin.aioa.ui.ChatModel
import com.hengxin.aioa.ui.ErrorNote
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private const val PREFS = "drive_view"
private const val GRID_MIN = 150

/** 视图偏好 (列表 / 网格, 排序) 记在本机。 */
private class ViewPrefs(context: Context) {
    private val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    var grid: Boolean
        get() = p.getBoolean("grid", false)
        set(v) = p.edit().putBoolean("grid", v).apply()
    var sort: DriveSort
        get() = DriveSort(runCatching { SortKey.valueOf(p.getString("key", null) ?: "") }.getOrDefault(SortKey.NAME), p.getBoolean("desc", false))
        set(v) = p.edit().putString("key", v.key.name).putBoolean("desc", v.desc).apply()
}

private enum class Sub { FILES, TRASH, SHARES, TRANSFERS }

/**
 * 网盘页 (#154): HX-CF-Drive 里网盘独立根目录下的目录树 (#158), 路径都是网盘内的。先显示本机缓存再刷新, 不轮询;
 * 只在进目录, 下拉刷新, 自己改动之后刷新。点文件先进预览页; 返回键先关预览与子页, 再退回上一级目录, 到根后交给外壳 (回总览)。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DrivePage(chat: ChatModel, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    DriveGate.load(context)
    DriveDownloads.load(context)
    val api = remember { DriveApi(context) }
    val prefs = remember { ViewPrefs(context) }
    val scope = rememberCoroutineScope()
    var sub by rememberSaveable { mutableStateOf(Sub.FILES) }
    var path by rememberSaveable { mutableStateOf("/") }
    var items by remember { mutableStateOf<List<DriveNode>?>(null) }
    var loading by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf<DriveError?>(null) }
    var grid by remember { mutableStateOf(prefs.grid) }
    var sort by remember { mutableStateOf(prefs.sort) }
    var query by rememberSaveable { mutableStateOf<String?>(null) }
    var found by remember { mutableStateOf<List<DriveNode>?>(null) }
    var stats by remember { mutableStateOf<DriveStats?>(null) }
    var acting by remember { mutableStateOf<DriveNode?>(null) }
    var dialog by remember { mutableStateOf<DriveDialog?>(null) }
    var menu by remember { mutableStateOf(false) }
    var viewing by remember { mutableStateOf<DriveNode?>(null) }

    fun refresh() {
        scope.launch {
            loading = true
            runCatching { api.list(path) }.onSuccess { if (it.changed || items == null) items = it.items; err = null }.onFailure { err = it as? DriveError ?: DriveError(it.message ?: "加载失败") }
            loading = false
        }
    }
    LaunchedEffect(path) {
        items = withContext(Dispatchers.IO) { api.cached(path) }
        refresh()
    }
    // 上传完成就刷新一次当前目录
    LaunchedEffect(DriveTransfers.finished) { if (DriveTransfers.finished > 0) refresh() }
    LaunchedEffect(Unit) { stats = runCatching { api.stats() }.getOrNull() }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        // 拿长期读权限: App 被杀后重选同一文件仍能接着传
        uris.forEach { u -> runCatching { context.contentResolver.takePersistableUriPermission(u, Intent.FLAG_GRANT_READ_URI_PERMISSION) } }
        if (uris.isNotEmpty()) DriveTransfers.upload(context, uris, path)
    }
    val back = viewing != null || query != null || path != "/" || sub != Sub.FILES
    BackHandler(back) {
        when {
            viewing != null -> viewing = null
            sub != Sub.FILES -> sub = Sub.FILES
            query != null -> { query = null; found = null }
            else -> path = DrivePaths.parent(path)
        }
    }
    when (sub) {
        Sub.TRASH -> return TrashPage(api, modifier) { sub = Sub.FILES; refresh() }
        Sub.SHARES -> return SharesPage(api, modifier) { sub = Sub.FILES }
        Sub.TRANSFERS -> return TransfersPage { sub = Sub.FILES }
        Sub.FILES -> Unit
    }
    viewing?.let { n ->
        PreviewPage(n, { viewing = null }) { dialog = it }
        dialog?.let { d -> DriveDialogs(d, api, chat, path, sort, { sort = it; prefs.sort = it }, { dialog = null }) { refresh() } }
        return
    }
    val open: (DriveNode) -> Unit = { n ->
        if (n.dir) { query = null; found = null; path = if (n.path.isNotEmpty()) n.path else DrivePaths.join(path, n.name) }
        else viewing = n
    }
    val shown = sortNodes(found ?: items.orEmpty(), sort)
    Column(modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(start = 12.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Crumbs(path, "网盘", Modifier.weight(1f)) { query = null; found = null; path = it }
            ToolIcon("search", query != null) { query = if (query == null) "" else null; found = null }
            ToolIcon(if (grid) "menu" else "layout-dashboard") { grid = !grid; prefs.grid = grid }
            ToolIcon("chevrons-up-down") { dialog = DriveDialog.Sort }
            ToolIcon("ellipsis") { menu = true }
        }
        query?.let { q ->
            OutlinedTextField(q, { query = it }, Modifier.fillMaxWidth().padding(horizontal = 12.dp), singleLine = true,
                placeholder = { androidx.compose.material3.Text("搜索文件名, 回车搜索") },
                keyboardActions = androidx.compose.foundation.text.KeyboardActions(onSearch = {
                    if (q.isNotBlank()) scope.launch { runCatching { api.search(q.trim()) }.onSuccess { found = it; err = null }.onFailure { err = it as? DriveError } }
                }),
                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(imeAction = androidx.compose.ui.text.input.ImeAction.Search))
        }
        Column(Modifier.padding(horizontal = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            err?.let { e -> ErrorNote(e.message ?: "出错了", Modifier.fillMaxWidth().padding(top = 6.dp), e.kind, onRetry = ::refresh) { err = null } }
            TransferSummary { sub = Sub.TRANSFERS }
            if (query == null) Row(Modifier.padding(vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                HxButton("上传", { pick.launch(arrayOf("*/*")) }, icon = "arrow-up", size = HxButtonSize.Sm)
                HxButton("新建文件夹", { dialog = DriveDialog.Mkdir }, icon = "plus", size = HxButtonSize.Sm, variant = HxButtonVariant.Outline)
            }
        }
        PullToRefreshBox(loading, ::refresh, Modifier.weight(1f).fillMaxWidth()) {
            val more: (DriveNode) -> Unit = { acting = it }
            val footer = footerText(shown.size, items == null && err == null, found != null, stats)
            if (grid) LazyVerticalGrid(GridCells.Adaptive(GRID_MIN.dp), Modifier.fillMaxSize(), contentPadding = PaddingValues(12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(shown, key = { it.id }) { n -> NodeCell(n, { open(n) }) { more(n) } }
                item(span = { androidx.compose.foundation.lazy.grid.GridItemSpan(maxLineSpan) }) { Note("hard-drive", footer) }
            } else LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(12.dp)) {
                itemsIndexed(shown, key = { _, n -> n.id }) { i, n -> NodeRow(n, i > 0, { open(n) }) { more(n) } }
                item { Note("hard-drive", footer) }
            }
        }
    }
    if (menu) PageMenu({ menu = false }, { sub = Sub.TRANSFERS }, { sub = Sub.TRASH }, { sub = Sub.SHARES }, ::refresh) { dialog = DriveDialog.About }
    acting?.let { n -> NodeActions(n, { acting = null }, open) { dialog = it } }
    dialog?.let { d ->
        DriveDialogs(d, api, chat, path, sort, { sort = it; prefs.sort = it }, { dialog = null }) { refresh() }
    }
}

/** 列表底部一句: 几项, 网盘总量 (令牌有 stats 权限时)。 */
private fun footerText(count: Int, loading: Boolean, searching: Boolean, stats: DriveStats?): String {
    if (loading) return "加载中..."
    val head = if (searching) "找到 $count 项" else if (count == 0) "空文件夹" else "共 $count 项"
    return stats?.let { "$head · 网盘共 ${sizeText(it.bytes)}, ${it.files} 个文件" } ?: head
}
