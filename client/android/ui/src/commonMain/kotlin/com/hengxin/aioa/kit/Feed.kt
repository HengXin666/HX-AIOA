package com.hengxin.aioa.kit

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/** 事件的语气, 由严重程度映射而来, 只决定强调色。 */
enum class Tone { Critical, Warning, Normal, Info }

/** 总览里的一条: 已聚合 (count > 1 表示同组多条) 且可追溯 (ids 由调用方保留)。 */
data class FeedItem(
    val id: String,
    val icon: String,
    val title: String,
    val summary: String? = null,
    val source: String? = null,
    val time: String? = null,
    val tone: Tone = Tone.Normal,
    val count: Int = 1,
)

@Composable
fun toneColor(tone: Tone): Color {
    val c = Aioa.colors
    return when (tone) {
        Tone.Critical -> c.danger
        Tone.Warning -> c.warning
        Tone.Normal -> c.text
        Tone.Info -> c.textSecondary
    }
}

/** 一行动态: 左侧语气圆点, 标题 + 摘要, 右侧时间与聚合数。 */
@Composable
fun FeedRow(item: FeedItem, onClick: (() -> Unit)? = null) {
    val c = Aioa.colors
    Row(
        Modifier.fillMaxWidth().pressable(onClick).padding(vertical = 6.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Column(Modifier.padding(top = 6.dp)) { Dot(toneColor(item.tone)) }
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(item.title, c.text, 15, Modifier.weight(1f), FontWeight.Medium)
                if (item.count > 1) Text(" ×${item.count}", c.textSecondary, 12)
            }
            item.summary?.let { Paragraph(it, c.textSecondary, 13, maxLines = 2) }
            val meta = listOfNotNull(item.source, item.time).joinToString(" · ")
            if (meta.isNotEmpty()) Text(meta, c.textSecondary.copy(alpha = 0.8f), 11)
        }
    }
}

/** 总览的一层: 小标题 + 说明 + 卡片内的若干行, 带空 / 加载 / 错误 / 过期状态。 */
@Composable
fun LayerSection(
    title: String,
    hint: String,
    items: List<FeedItem>,
    state: CardState,
    emptyText: String,
    onRetry: (() -> Unit)? = null,
    onItem: ((FeedItem) -> Unit)? = null,
) {
    val c = Aioa.colors
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.Bottom) {
            Text(title, c.text, 17, weight = FontWeight.SemiBold)
            Spacer(Modifier.width(8.dp))
            Text(hint, c.textSecondary, 12)
        }
        Card {
            val shown = if (state == CardState.Ready && items.isEmpty()) CardState.Empty else state
            StateBody(shown, emptyText, onRetry) {
                items.forEach { item -> FeedRow(item, onItem?.let { { it(item) } }) }
            }
        }
    }
}
