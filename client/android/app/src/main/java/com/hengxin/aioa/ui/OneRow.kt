package com.hengxin.aioa.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.pointerTap

private const val META_ALPHA = 0.8f
private val META_MAX = 160.dp

/** 列表一行一条 (#121 #138): 左图标, 标题单行, 说明压到右边小字, 最右可放标签 / 小进度条 / 动作。 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun OneRow(
    icon: String,
    title: String,
    meta: String = "",
    tint: Color = Aioa.colors.textSecondary,
    pad: Int = 0,
    onLongClick: (() -> Unit)? = null,
    onClick: (() -> Unit)? = null,
    end: (@Composable () -> Unit)? = null,
) {
    val c = Aioa.colors
    val click = if (onClick != null || onLongClick != null) Modifier.combinedClickable(onLongClick = onLongClick) { (onClick ?: onLongClick)?.invoke() } else Modifier
    Row(
        Modifier.fillMaxWidth().then(click).padding(horizontal = pad.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(icon, tint, 16.dp)
        Text(title, c.text, 14, Modifier.weight(1f))
        if (meta.isNotEmpty()) Text(meta, c.textSecondary.copy(alpha = META_ALPHA), 11, Modifier.widthIn(max = META_MAX))
        end?.invoke()
    }
}

/** 行尾的小文字动作 (作废, 移除): 圆角矩形热区。 */
@Composable
fun RowAction(label: String, danger: Boolean = false, onClick: () -> Unit) {
    val c = Aioa.colors
    Text(label, if (danger) c.danger else c.accent, 12, Modifier.clip(RoundedCornerShape(6.dp)).pointerTap(onClick).padding(horizontal = 6.dp, vertical = 4.dp))
}
