package com.hengxin.aioa.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.pointerTap

private val BAR_H = 56.dp
private val RIGHT_BOX = 44.dp
private val RIGHT_BTN = 36.dp
private const val MAX_BADGE = 99

/** 二级页顶栏 (会话, 域, 多选, 合并转发详情): 返回, 居中标题与副标题, 右上圆钮; onTitle 点标题。 */
@Composable
fun SubBar(
    title: String,
    sub: String,
    onBack: () -> Unit,
    right: String? = "ellipsis",
    onRight: () -> Unit = {},
    subTone: Color? = null,
    back: String = "chevron-left",
    onTitle: (() -> Unit)? = null,
    backCount: Int = 0,
) {
    val c = Aioa.colors
    Column(Modifier.background(c.background)) {
        Row(Modifier.fillMaxWidth().height(BAR_H).padding(horizontal = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Row(Modifier.height(RIGHT_BOX).clip(RoundedCornerShape(12.dp)).pointerTap(onBack).padding(horizontal = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(back, c.text, 24.dp)
                if (backCount > 0) Text(if (backCount > MAX_BADGE) "$MAX_BADGE+" else "$backCount", c.textSecondary, 15)
            }
            Column(
                Modifier.weight(1f).clip(RoundedCornerShape(10.dp)).then(if (onTitle != null) Modifier.pointerTap(onTitle) else Modifier),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(title, c.text, 17, weight = FontWeight.SemiBold)
                if (sub.isNotEmpty()) Text(sub, subTone ?: c.textSecondary, 12)
            }
            Box(Modifier.size(RIGHT_BOX), contentAlignment = Alignment.Center) {
                if (right != null) {
                    Box(
                        Modifier.size(RIGHT_BTN).clip(CircleShape).background(c.surface).border(1.dp, c.border, CircleShape).pointerTap(onRight),
                        contentAlignment = Alignment.Center,
                    ) { Icon(right, c.text, 18.dp) }
                }
            }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.border.copy(alpha = 0.6f)))
    }
}

/** 点按与长按 (列表行, 头像, 气泡); 不带水波纹, 和 kit 的 pointerTap 一致。 */
fun Modifier.tapHold(onTap: () -> Unit, onLong: (() -> Unit)?): Modifier = this.then(
    Modifier.pointerInput(onTap, onLong) {
        detectTapGestures(onTap = { onTap() }, onLongPress = onLong?.let { l -> { l() } })
    },
)
