package com.hengxin.aioa.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.sizeIn
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
// 次行最多这么多行, 再多去详情看
private const val SUB_LINES = 2
// 行尾动作的最小热区 (#139): 无障碍要求 48dp
private val TOUCH_MIN = 48.dp

/**
 * 列表一行一条 (#121 #138): 左图标, 标题单行, 说明压到右边小字, 最右可放标签 / 小进度条 / 动作。
 * sub 是标题下的小字次行 (简介, 推送, 注册的 Agent...), alert 是标红的次行 (CI 失败等); 都为空时仍是一行。
 */
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
    sub: String = "",
    alert: String = "",
    end: (@Composable () -> Unit)? = null,
) {
    val c = Aioa.colors
    val click = if (onClick != null || onLongClick != null) Modifier.combinedClickable(onLongClick = onLongClick) { (onClick ?: onLongClick)?.invoke() } else Modifier
    val two = sub.isNotEmpty() || alert.isNotEmpty()
    Row(
        Modifier.fillMaxWidth().then(click).padding(horizontal = pad.dp, vertical = 9.dp),
        verticalAlignment = if (two) Alignment.Top else Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(icon, tint, 16.dp, if (two) Modifier.padding(top = 2.dp) else Modifier)
        if (!two) Text(title, c.text, 14, Modifier.weight(1f))
        else Column(Modifier.weight(1f)) {
            Text(title, c.text, 14)
            if (alert.isNotEmpty()) Text(alert, c.danger, 12, Modifier.padding(top = 2.dp))
            if (sub.isNotEmpty()) Text(sub, c.textSecondary, 12, Modifier.padding(top = 2.dp), maxLines = SUB_LINES)
        }
        if (meta.isNotEmpty()) Text(meta, c.textSecondary.copy(alpha = META_ALPHA), 11, Modifier.widthIn(max = META_MAX))
        end?.invoke()
    }
}

/** 行尾的小文字动作 (作废, 移除): 字是小的, 热区至少 48dp (#139)。 */
@Composable
fun RowAction(label: String, danger: Boolean = false, onClick: () -> Unit) {
    val c = Aioa.colors
    Box(Modifier.sizeIn(minWidth = TOUCH_MIN, minHeight = TOUCH_MIN).clip(RoundedCornerShape(6.dp)).pointerTap(onClick), contentAlignment = Alignment.Center) {
        Text(label, if (danger) c.danger else c.accent, 12, Modifier.padding(horizontal = 6.dp))
    }
}
