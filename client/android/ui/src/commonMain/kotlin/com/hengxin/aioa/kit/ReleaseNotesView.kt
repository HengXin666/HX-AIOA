package com.hengxin.aioa.kit

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

private const val MAX_LINES_SHOWN = 12

/** 更新公告的内容: 版本号 + 条目列表 + 关闭按钮; 安卓里放进底部抽屉, 画廊里直接画。 */
@Composable
fun ReleaseNotesView(versionName: String, lines: List<String>, onClose: (() -> Unit)? = null) {
    val c = Aioa.colors
    Column(Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("更新内容", c.text, 20, weight = FontWeight.SemiBold)
        Text(versionName, c.textSecondary, 13)
        lines.take(MAX_LINES_SHOWN).forEach { line ->
            Row {
                Text("·", c.textSecondary, 14)
                Spacer(Modifier.width(8.dp))
                Paragraph(line, c.text, 14)
            }
        }
        if (lines.size > MAX_LINES_SHOWN) Text("另有 ${lines.size - MAX_LINES_SHOWN} 项, 在 我的 → 版本 查看", c.textSecondary, 12)
        onClose?.let { PillButton("知道了", ButtonStyle.Primary, onClick = it) }
    }
}
