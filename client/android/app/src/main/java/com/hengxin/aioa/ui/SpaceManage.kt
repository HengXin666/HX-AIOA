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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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
 * 管理空间与排序 (#139): 顶部标签与侧栏 "空间" 的顺序 (上移 / 下移), 置顶开关 (最多 [MAX_PINNED] 个, 跟账号走),
 * 插件空间可以隐藏 (PUT state.hidden)。总览固定在第一个, 不能挪, 藏, 取消置顶; 内置页面不能藏。
 * 没设过的页面按优先级自动补空位, 每行标出 置顶 / 自动 / 更多; 手动置顶会挤掉自动补位的, 五个都是自己置顶的才要先取消一个。
 * 点行首图标换图标 (#142, [SpaceIconSheet]): 内置页面与插件空间都能换, 跟账号走。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SpaceManageSheet(s: SpacesState, unread: Int, close: () -> Unit) {
    val c = Aioa.colors
    val pins = s.pins()
    val all = homeTabs(s.spaces, unread, s.tabOrder, withHidden = true, pins = pins, icons = s.tabs.icons, drive = com.hengxin.aioa.ui.drive.DriveGate.on == true)
    var iconFor by remember { mutableStateOf<HomeSpace?>(null) }
    val context = androidx.compose.ui.platform.LocalContext.current
    val pinnedCount = all.count { it.pinned }
    val firm = all.withIndex().count { (i, t) -> pinState(t, i == 0, pins) == PinState.PINNED }
    val pin = { t: HomeSpace, i: Int ->
        when {
            // 取消自动补位的也记成用户明确不要它置顶, 不然空位马上又被它补上
            t.pinned -> s.setPinned(t.id, false)
            firm >= MAX_PINNED -> android.widget.Toast.makeText(context, "顶部标签最多置顶 $MAX_PINNED 个, 先取消一个", android.widget.Toast.LENGTH_SHORT).show()
            else -> s.setPinned(t.id, true)
        }
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
            Text(
                "顶部标签放 $pinnedCount/$MAX_PINNED 个, 你置顶的优先, 空位自动补; 其余在侧栏 \"更多空间\", 插件空间可以先藏起来; 点图标可换",
                c.textSecondary, 12, Modifier.padding(start = 4.dp, bottom = 10.dp), maxLines = 2,
            )
            all.forEachIndexed { i, t -> ManageRow(t, i, all.size, pinState(t, i == 0, pins), s, move, { iconFor = t }) { pin(t, i) } }
            if (s.tabOrder.isNotEmpty() || pins.isNotEmpty()) {
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).pointerTap { s.resetTabs() }.padding(horizontal = 4.dp, vertical = 12.dp)) {
                    Text("恢复默认 (顺序与置顶)", c.textSecondary, 14)
                }
            }
        }
    }
    iconFor?.let { t ->
        val changed = s.spaces.firstOrNull { it.id == t.id }?.layout?.icon != null || t.id in s.tabs.icons
        SpaceIconSheet(t.title, t.icon, changed, { s.setIcon(t.id, it) }) { iconFor = null }
    }
}

@Composable
private fun ManageRow(t: HomeSpace, i: Int, n: Int, state: PinState, s: SpacesState, move: (Int, Int) -> Unit, onIcon: () -> Unit, pin: () -> Unit) {
    val c = Aioa.colors
    val space = s.spaces.firstOrNull { it.id == t.id }
    val hidden = space?.layout?.hidden == true
    val tone = if (hidden) c.textSecondary else c.text
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        androidx.compose.foundation.layout.Box(Modifier.clip(RoundedCornerShape(10.dp)).pointerTap(onIcon)) { Glyph(t.icon, tone) }
        Column(Modifier.weight(1f)) {
            Text(t.title, tone, 15, weight = FontWeight.Medium)
            val kind = if (space == null) "内置" else "插件"
            Text(
                when {
                    i == 0 -> "固定在第一个, 总是置顶"
                    hidden -> "$kind · 已隐藏"
                    state == PinState.PINNED -> "$kind · 置顶"
                    state == PinState.AUTO -> "$kind · 自动 (空位补上的)"
                    else -> "$kind · 更多空间"
                },
                if (state == PinState.AUTO && !hidden) c.accent else c.textSecondary, 12,
            )
        }
        if (i > 0 && !hidden) Tap("pin", tint = if (t.pinned) c.accent else c.textSecondary, onClick = pin)
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
