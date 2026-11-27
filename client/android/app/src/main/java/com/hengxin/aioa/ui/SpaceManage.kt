package com.hengxin.aioa.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Glyph
import com.hengxin.aioa.kit.HomeSpace
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.pointerTap

/**
 * 管理空间与排序 (#139): 顶部标签与侧栏 "空间" 的顺序 (上移 / 下移, 存本机), 置顶开关 (最多 [MAX_PINNED] 个),
 * 插件空间可以隐藏 (PUT state.hidden)。总览固定在第一个, 不能挪, 藏, 取消置顶; 内置页面不能藏。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SpaceManageSheet(s: SpacesState, unread: Int, close: () -> Unit) {
    val c = Aioa.colors
    val all = homeTabs(s.spaces, unread, s.tabOrder, withHidden = true, pins = s.pins())
    val context = androidx.compose.ui.platform.LocalContext.current
    val pinnedCount = all.count { it.pinned }
    val pin = { t: HomeSpace ->
        if (!t.pinned && pinnedCount >= MAX_PINNED) {
            android.widget.Toast.makeText(context, "顶部标签最多置顶 $MAX_PINNED 个, 先取消一个", android.widget.Toast.LENGTH_SHORT).show()
        } else s.setPinned(t.id, !t.pinned)
    }
    val move = { i: Int, d: Int ->
        val ids = all.map { it.id }.toMutableList()
        val j = i + d
        if (i >= 1 && j >= 1 && j < ids.size) {
            ids[i] = ids[j].also { ids[j] = ids[i] }
            s.saveTabOrder(ids)
        }
    }
    ModalBottomSheet(close, containerColor = c.popover) {
        Column(Modifier.navigationBarsPadding().verticalScroll(rememberScrollState()).padding(horizontal = 14.dp).padding(bottom = 18.dp)) {
            Text("管理空间与排序", c.text, 16, Modifier.padding(start = 4.dp, bottom = 2.dp), weight = FontWeight.SemiBold)
            Text("顶部标签只放置顶的 (已置顶 $pinnedCount/$MAX_PINNED), 其余在侧栏 \"更多空间\"; 插件空间可以先藏起来", c.textSecondary, 12, Modifier.padding(start = 4.dp, bottom = 10.dp), maxLines = 2)
            all.forEachIndexed { i, t -> ManageRow(t, i, all.size, s, move, pin) }
            if (s.tabOrder.isNotEmpty()) {
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).pointerTap { s.saveTabOrder(emptyList()) }.padding(horizontal = 4.dp, vertical = 12.dp)) {
                    Text("恢复默认顺序", c.textSecondary, 14)
                }
            }
        }
    }
}

@Composable
private fun ManageRow(t: HomeSpace, i: Int, n: Int, s: SpacesState, move: (Int, Int) -> Unit, pin: (HomeSpace) -> Unit) {
    val c = Aioa.colors
    val space = s.spaces.firstOrNull { it.id == t.id }
    val hidden = space?.layout?.hidden == true
    val tone = if (hidden) c.textSecondary else c.text
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Glyph(t.icon, tone)
        Column(Modifier.weight(1f)) {
            Text(t.title, tone, 15, weight = FontWeight.Medium)
            Text(
                when {
                    i == 0 -> "固定在第一个, 总是置顶"
                    space == null -> if (t.pinned) "内置 · 置顶" else "内置"
                    hidden -> "插件 · 已隐藏"
                    else -> if (t.pinned) "插件 · 置顶" else "插件"
                },
                c.textSecondary, 12,
            )
        }
        if (i > 0 && !hidden) Tap("pin", tint = if (t.pinned) c.accent else c.textSecondary) { pin(t) }
        if (space != null) Tap(if (hidden) "eye-off" else "eye") { s.setHidden(space, !hidden) }
        if (i > 0) {
            Tap("chevron-up", enabled = i > 1) { move(i, -1) }
            Tap("chevron-down", enabled = i < n - 1) { move(i, 1) }
        }
    }
}

@Composable
private fun Tap(icon: String, enabled: Boolean = true, tint: androidx.compose.ui.graphics.Color? = null, onClick: () -> Unit) {
    val c = Aioa.colors
    val m = Modifier.size(40.dp).clip(RoundedCornerShape(8.dp))
    androidx.compose.foundation.layout.Box(if (enabled) m.pointerTap(onClick) else m, contentAlignment = Alignment.Center) {
        Icon(icon, if (enabled) tint ?: c.text else c.border, 18.dp)
    }
}
