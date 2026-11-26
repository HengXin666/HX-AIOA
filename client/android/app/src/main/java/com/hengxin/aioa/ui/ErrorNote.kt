package com.hengxin.aioa.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.net.ErrKind

private const val SOFT = 0.12f
private val SHAPE = RoundedCornerShape(8.dp)

/**
 * 分类显示的错误条 (#110): 网络与超时用警告色并给重试, 登录与权限用危险色, 其他用次要色。
 * 点文字收起; kind 不给时按文字猜。
 */
@Composable
fun ErrorNote(text: String, modifier: Modifier = Modifier, kind: ErrKind = ErrKind.guess(text), onRetry: (() -> Unit)? = null, onDismiss: (() -> Unit)? = null) {
    val c = Aioa.colors
    val tint: Color = when (kind) {
        ErrKind.TIMEOUT, ErrKind.NETWORK, ErrKind.SERVER -> c.warning
        ErrKind.AUTH, ErrKind.DENIED -> c.danger
        ErrKind.INPUT, ErrKind.OTHER -> c.danger
    }
    Row(
        modifier.clip(SHAPE).background(tint.copy(alpha = SOFT)).padding(horizontal = 10.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(kind.icon, tint, 15.dp)
        Text(
            text,
            Modifier.weight(1f).let { m -> onDismiss?.let { m.clickable(onClick = it) } ?: m },
            color = c.text, fontSize = 12.sp, lineHeight = 16.sp, maxLines = 3, overflow = TextOverflow.Ellipsis,
        )
        if (onRetry != null && kind.retry) {
            Text("重试", Modifier.clip(SHAPE).clickable(onClick = onRetry).padding(horizontal = 6.dp, vertical = 2.dp), color = tint, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}
