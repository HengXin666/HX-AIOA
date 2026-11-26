package com.hengxin.aioa.ui.todo

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.ui.SpacesState
import kotlinx.coroutines.delay

// 撤销条停留多久
private const val UNDO_SHOW_MS = 6_000L

/** 刚勾完成后出现的 "撤销" 条: 周期待办提示已排到下一期; 点撤销退回, 几秒后自动消失。 */
@Composable
fun UndoBar(spaces: SpacesState, modifier: Modifier = Modifier) {
    val r = spaces.undo ?: return
    val c = Aioa.colors
    LaunchedEffect(r) {
        delay(UNDO_SHOW_MS)
        if (spaces.undo == r) spaces.undo = null
    }
    val text = if (r.everyUnit != null) "已完成, 排到下一期: ${r.title}" else "已完成: ${r.title}"
    Row(modifier.clip(RoundedCornerShape(12.dp)).background(c.text).padding(start = 14.dp, end = 6.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon("square-check", c.background, 16.dp)
        Text(text, Modifier.padding(start = 8.dp).weight(1f, fill = false), color = c.background, fontSize = 13.sp)
        Text("撤销", Modifier.padding(start = 8.dp).clip(RoundedCornerShape(8.dp)).clickable { spaces.undoDone() }.padding(horizontal = 10.dp, vertical = 6.dp), color = c.accent, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
    }
}
