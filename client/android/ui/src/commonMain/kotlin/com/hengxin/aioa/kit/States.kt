package com.hengxin.aioa.kit

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private const val STALE_ALPHA = 0.55f
private const val HINT_SP = 14

/** 任意组件的统一状态外壳: 加载骨架, 空, 错误, 过期 (内容变淡并标出最后更新时间), 正常直接显示内容。 */
@Composable
fun StateBody(
    state: CardState,
    emptyText: String = "暂无数据",
    onRetry: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val c = Aioa.colors
    when (state) {
        CardState.Loading -> Skeleton()
        CardState.Empty -> Text(emptyText, c.textSecondary, HINT_SP)
        is CardState.Error -> Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon("alert-triangle", c.danger, 16.dp)
                Spacer(Modifier.width(6.dp))
                Text(state.reason, c.danger, HINT_SP)
            }
            onRetry?.let { Chip("重试", false, it) }
        }
        is CardState.Stale -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Column(Modifier.alpha(STALE_ALPHA), verticalArrangement = Arrangement.spacedBy(8.dp), content = content)
            Text("已过期 · 最后更新 ${state.lastUpdate}", c.warning, 12)
        }
        CardState.Ready -> Column(verticalArrangement = Arrangement.spacedBy(8.dp), content = content)
    }
}

/** 多行文字: 摘要, 公告条目等需要换行的地方用它, 单行标题仍用 [Text]。 */
@Composable
fun Paragraph(text: String, color: Color, sizeSp: Int, maxLines: Int = Int.MAX_VALUE, modifier: Modifier = Modifier) {
    BasicText(
        text,
        modifier,
        style = TextStyle(color = color, fontSize = sizeSp.sp, lineHeight = (sizeSp + 6).sp),
        overflow = TextOverflow.Ellipsis,
        maxLines = maxLines,
    )
}
