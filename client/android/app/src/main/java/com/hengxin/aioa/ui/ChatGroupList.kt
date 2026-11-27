package com.hengxin.aioa.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.kit.DropMenu
import com.hengxin.aioa.kit.MenuEntry
import com.hengxin.aioa.kit.enter
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val LIST_PAD = 14.dp
private const val MENU_DROP = 150
private const val TICK_MS = 1000L
private const val MAX_ENTER = 12
private const val K_NEW_GROUP = "new-group"
private const val K_NEW_FOLDER = "new-folder"
private const val K_JOIN = "join"
private const val K_FAV = "fav"
private const val K_TAGS = "tags"

/** 消息列表 v2 (#135): 一列; 置顶超过 3 个折叠; 域是一行, 点进去是一组群; 顶部按标签筛选。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GroupList(model: ChatModel) {
    val g = model.groups
    var dialog by remember { mutableStateOf<ListDialog?>(null) }
    var menu by remember { mutableStateOf(false) }
    var tag by rememberSaveable { mutableStateOf<String?>(null) }
    var unreadOnly by rememberSaveable { mutableStateOf(false) }
    var pinsOpen by rememberSaveable { mutableStateOf(false) }
    // 打开的域: 存成可保存状态, 从域里进群再退出时回到域里 (像 QQ 群助手)
    var domain by rememberSaveable { mutableStateOf<String?>(null) }
    LaunchedEffect(g.pendingInvite) { if (g.pendingInvite != null) dialog = ListDialog.Join }
    LaunchedEffect(g.pendingNewGroup) { if (g.pendingNewGroup) { g.pendingNewGroup = false; dialog = ListDialog.NewGroup } }
    val tags = g.tags.tags
    LaunchedEffect(tags.keys) { if (tag != null && tag !in tags) tag = null }
    val rows = g.rows()
    val filter = ListFilter(tag?.let { tags[it]?.toSet() }, unreadOnly)
    val entries = remember(rows, g.folders, filter, pinsOpen) { layoutList(rows, g.folders, filter, pinsOpen) }
    // 每秒的时钟只在行里读 (#139): 读 State 的是调用 live 的那一行, 不再每秒整表重组
    val clock = produceState(System.currentTimeMillis()) { while (true) { delay(TICK_MS); value = System.currentTimeMillis() } }
    val live: (String) -> String? = remember(g, model) { { key -> if (model.online) g.presence.line(key, clock.value) else null } }
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            if (!LocalShellBar.current) Header("消息", model.online)
            val err = g.error ?: g.directory.error ?: g.tags.error
            if (err != null) ErrorNote(err, Modifier.fillMaxWidth().padding(horizontal = LIST_PAD, vertical = 4.dp), onDismiss = { g.clearError() })
            PullToRefreshBox(g.syncing, g::syncNow, Modifier.fillMaxSize()) {
                LazyColumn(Modifier.fillMaxSize().padding(horizontal = LIST_PAD)) {
                    item(key = "tags") {
                        TagBar(tags.keys.toList(), tag, unreadOnly, unreadCount(rows), { tag = it; unreadOnly = false }, { unreadOnly = !unreadOnly; tag = null }) { menu = true }
                    }
                    entries.forEachIndexed { i, e ->
                        item(key = e.key) {
                            val mod = Modifier.animateItem().enter(minOf(i, MAX_ENTER))
                            when (e) {
                                is ListEntry.Conv -> ConvRow(e.row, e.pinned, i > 0 && entries[i - 1] !is ListEntry.Fold, live(e.row.key), { g.openGroup(e.row.key) }, { dialog = ListDialog.Actions(e.row.key) }, mod)
                                is ListEntry.Domain -> DomainRow(e, i > 0 && entries[i - 1] !is ListEntry.Fold, { domain = e.name }, { dialog = ListDialog.DomainActions(e.name) }, mod)
                                is ListEntry.Fold -> FoldRow(e, { pinsOpen = !pinsOpen }, mod)
                            }
                        }
                    }
                    if (entries.isEmpty()) item(key = "empty") {
                        ListNote(
                            if (filter.active) "没有符合筛选的会话。长按会话可以打标签。"
                            else "还没有群。右上角 + 新建群, 再在群设置里接入 Agent; 推送时带上 channel 也会自动进对应的群。",
                        )
                    }
                }
            }
        }
        DropMenu(
            menu,
            listOf(
                MenuEntry(K_NEW_GROUP, "新建群", "message-square-plus"),
                MenuEntry(K_NEW_FOLDER, "新建域", "layers", "把几个群收成一行"),
                MenuEntry(K_JOIN, "加入群", "scan-line"),
                MenuEntry(K_FAV, "收藏", "star", divider = true),
                MenuEntry(K_TAGS, "管理标签", "tag"),
            ),
            { e ->
                menu = false
                when (e.key) {
                    K_NEW_GROUP -> dialog = ListDialog.NewGroup
                    K_NEW_FOLDER -> dialog = ListDialog.NewFolder
                    K_JOIN -> dialog = ListDialog.Join
                    K_FAV -> g.favoritesOpen = true
                    K_TAGS -> dialog = ListDialog.Tags(null)
                }
            },
            { menu = false },
            offset = IntOffset(0, MENU_DROP),
        )
    }
    // 域被删了就退出来; 放在副作用里改, 不在组合阶段改状态 (#139)
    LaunchedEffect(domain, g.folders) { if (domain != null && g.folders.none { it.name == domain }) domain = null }
    domain?.takeIf { name -> g.folders.any { it.name == name } }?.let { name ->
        DomainPage(model, name, live, { domain = null }) { dialog = ListDialog.Actions(it) }
    }
    ListDialogs(g, dialog) { dialog = it }
}

/** 删除群确认: 说清楚会删掉什么。 */
@Composable
internal fun DeleteGroupDialog(g: ChatGroups, group: String, close: () -> Unit) {
    var busy by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = { if (!busy) close() },
        title = { Text("删除群 \"${g.directory.title(group)}\"?") },
        text = { Text("聊天记录, 文件, 接入的 Agent (密钥作废), 插件与待办, 群成员都会删掉, 所有设备同步, 不能恢复。之后再有推送进这个群, 它会重新出现。") },
        confirmButton = {
            TextButton({
                busy = true
                g.deleteGroup(group) { close() }
            }, enabled = !busy) { Text(if (busy) "正在删除..." else "删除", color = MaterialTheme.colorScheme.error) }
        },
        dismissButton = { TextButton(close, enabled = !busy) { Text("取消") } },
    )
}

/** 输入名字的对话框; ok 返回 false 表示重名或为空, 不关闭。 */
@Composable
internal fun NameDialog(title: String, hint: String, close: () -> Unit, initial: String = "", ok: (String) -> Boolean) {
    var name by remember { mutableStateOf(initial) }
    var bad by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = close,
        title = { Text(title) },
        text = { OutlinedTextField(name, { name = it; bad = false }, singleLine = true, isError = bad, placeholder = { Text(hint) }) },
        confirmButton = { TextButton({ if (ok(name)) close() else bad = true }) { Text("确定") } },
        dismissButton = { TextButton(close) { Text("取消") } },
    )
}

/** 粘贴邀请链接或邀请码进群; 成功后打开那个群, 历史由云端补。 */
@Composable
internal fun JoinDialog(initial: String, close: () -> Unit, joined: (String) -> Unit) {
    val context = androidx.compose.ui.platform.LocalContext.current.applicationContext
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    var text by remember { mutableStateOf(initial) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = close,
        title = { Text("加入群") },
        text = {
            Column {
                androidx.compose.material3.OutlinedTextField(text, { text = it }, Modifier.fillMaxWidth(), label = { Text("邀请链接或邀请码") })
                error?.let { Text(it, fontSize = 12.sp, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            TextButton({
                busy = true
                scope.launch {
                    com.hengxin.aioa.ui.chat.RoomApi(context).join(text).onSuccess(joined).onFailure { error = it.message }
                    busy = false
                }
            }, enabled = !busy && text.isNotBlank()) { Text(if (busy) "加入中..." else "加入") }
        },
        dismissButton = { TextButton(close) { Text("取消") } },
    )
}
