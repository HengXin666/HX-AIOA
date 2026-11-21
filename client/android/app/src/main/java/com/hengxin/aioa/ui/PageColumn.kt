package com.hengxin.aioa.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Text

private const val TITLE_SP = 26
private const val SECTION_SP = 15

/** 页面骨架: 标题 + 可滚动的一列卡片。 */
@Composable
fun PageColumn(title: String, content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(Aioa.metrics.gap),
    ) {
        Text(title, Aioa.colors.text, TITLE_SP)
        content()
        Spacer(Modifier.height(8.dp))
    }
}

@Composable
fun PageSection(title: String) {
    Spacer(Modifier.height(4.dp))
    Text(title, Aioa.colors.text, SECTION_SP)
}
