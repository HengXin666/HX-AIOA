package com.hengxin.aioa.kit

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.getValue
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.Box
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
fun FeedRow(item: FeedItem, onClick: (() -> Unit)? = null, onDismiss: (() -> Unit)? = null) {
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
        if (onDismiss != null) {
            Box(Modifier.size(DISMISS_TOUCH).pressable(onDismiss), contentAlignment = Alignment.Center) {
                Icon("x", c.textSecondary.copy(alpha = 0.7f), 14.dp)
            }
        }
    }
}

/** 总览的一层: 小标题 + 说明 + 卡片内的若干行, 带空 / 加载 / 错误 / 过期状态。
 *  limit 之外的折叠成 "还有 N 条"; 给了 onDismiss 每行可划掉, 给了 onClear 标题旁有 "全部已读"。 */
@Composable
fun LayerSection(
    title: String,
    hint: String,
    items: List<FeedItem>,
    state: CardState,
    emptyText: String,
    onRetry: (() -> Unit)? = null,
    limit: Int = Int.MAX_VALUE,
    onDismiss: ((FeedItem) -> Unit)? = null,
    onClear: (() -> Unit)? = null,
    onItem: ((FeedItem) -> Unit)? = null,
) {
    val c = Aioa.colors
    var all by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.Bottom) {
            Text(title, c.text, 17, weight = FontWeight.SemiBold)
            Spacer(Modifier.width(8.dp))
            Text(hint, c.textSecondary, 12, Modifier.weight(1f))
            if (onClear != null && items.isNotEmpty()) Text(CLEAR_LABEL, c.accent, 13, Modifier.pressable(onClear))
        }
        Card {
            val shown = if (state == CardState.Ready && items.isEmpty()) CardState.Empty else state
            StateBody(shown, emptyText, onRetry) {
                val visible = if (all) items else items.take(limit)
                AnimatedItems(visible, { it.id }) { item ->
                    FeedRow(item, onItem?.let { { it(item) } }, onDismiss?.let { { it(item) } })
                }
                val rest = items.size - visible.size
                if (rest > 0 || (all && items.size > limit)) {
                    Text(if (all) "收起" else "还有 $rest 条", c.accent, 13, Modifier.pressable { all = !all }.padding(vertical = 4.dp))
                }
            }
        }
    }
}

private const val CLEAR_LABEL = "全部已读"
private val DISMISS_TOUCH = 28.dp
