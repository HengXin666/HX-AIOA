package com.hengxin.aioa.ui.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Glyph
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.pointerTap

/** 抽屉里的一项: on 非空时右边画勾 (勾选类), danger 为红字; lead 非空时代替图标 (选会话时放头像, #147)。 */
data class SheetAction(
    val icon: String, val title: String, val hint: String = "", val danger: Boolean = false, val on: Boolean? = null,
    val lead: (@Composable () -> Unit)? = null, val run: () -> Unit,
)

/** 底部操作抽屉 (长按群, 资料卡, 更多): 标题 + 一行一项; 点完是否关闭由 run 自己决定。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ActionSheet(title: String, actions: List<SheetAction>, close: () -> Unit, footer: (@Composable ColumnScope.() -> Unit)? = null) {
    val c = Aioa.colors
    ModalBottomSheet(close, containerColor = c.popover) {
        Column(Modifier.navigationBarsPadding().verticalScroll(rememberScrollState()).padding(horizontal = 14.dp).padding(bottom = 18.dp)) {
            if (title.isNotEmpty()) Text(title, c.textSecondary, 13, Modifier.padding(start = 4.dp, bottom = 8.dp))
            actions.forEach { SheetRow(it) }
            footer?.invoke(this)
        }
    }
}

@Composable
private fun SheetRow(a: SheetAction) {
    val c = Aioa.colors
    val tone = if (a.danger) c.danger else c.text
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).pointerTap(a.run).padding(horizontal = 4.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        a.lead?.invoke() ?: Glyph(a.icon, tone)
        Column(Modifier.weight(1f)) {
            Text(a.title, tone, 15, weight = FontWeight.Medium)
            if (a.hint.isNotEmpty()) Text(a.hint, c.textSecondary, 12)
        }
        if (a.on == true) Icon("check", c.text, 18.dp)
    }
}
