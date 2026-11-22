package com.hengxin.aioa.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.ButtonStyle
import com.hengxin.aioa.kit.PillButton
import com.hengxin.aioa.kit.ReleaseNotesView
import com.hengxin.aioa.update.ReleaseNote

/** 更新公告底部抽屉: 新版本首次启动弹一次, 我的 → 版本与更新公告 里看历史。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NotesSheet(notes: List<ReleaseNote>, onClose: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onClose, containerColor = Aioa.colors.background) {
        Column(Modifier.verticalScroll(rememberScrollState())) {
            if (notes.isEmpty()) ReleaseNotesView("暂无公告, 检查更新后会出现在这里", emptyList())
            notes.forEach { ReleaseNotesView(it.versionName, it.lines) }
            Box(Modifier.padding(start = 20.dp, bottom = 24.dp)) { PillButton("知道了", ButtonStyle.Primary, onClick = onClose) }
        }
    }
}
