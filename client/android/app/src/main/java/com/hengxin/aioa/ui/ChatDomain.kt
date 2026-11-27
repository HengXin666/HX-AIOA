package com.hengxin.aioa.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.enter
import com.hengxin.aioa.ui.chat.SubBar

/** 域里面 (#135): 同样的会话行, 顶栏 "域 · n 个群 · m 条未读"; 盖住外壳, 返回回列表。 */
@Composable
internal fun DomainPage(model: ChatModel, name: String, live: (String) -> String?, close: () -> Unit, onLong: (String) -> Unit) {
    val g = model.groups
    val rows = g.rows()
    val d = layoutList(rows, g.folders.filter { it.name == name }, ListFilter(), pinsOpen = true)
        .filterIsInstance<ListEntry.Domain>().firstOrNull() ?: ListEntry.Domain(name, emptyList())
    Dialog(close, DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Column(Modifier.fillMaxSize().background(Aioa.colors.background).safeDrawingPadding()) {
            val unread = if (d.unread > 0) " · ${d.unread} 条未读" else ""
            SubBar(name, "域 · ${d.rows.size} 个群$unread", close, right = null)
            LazyColumn(Modifier.weight(1f).padding(horizontal = 14.dp)) {
                d.rows.forEachIndexed { i, r ->
                    item(key = r.key) {
                        ConvRow(r, r.pinned, i > 0, live(r.key), { g.openGroup(r.key) }, { onLong(r.key) }, Modifier.animateItem().enter(i))
                    }
                }
                item(key = "note") { ListNote("长按群可移出这个域; 一个群只在一个域里, 标签可以打多个。") }
            }
        }
    }
}
