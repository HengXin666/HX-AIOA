package com.hengxin.aioa.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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

/** 自动下载好新版本后的提示: 安装或稍后 (本次打开不再弹)。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReadySheet(note: ReleaseNote, onInstall: () -> Unit, onLater: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onLater, containerColor = Aioa.colors.background) {
        Column(Modifier.verticalScroll(rememberScrollState())) {
            ReleaseNotesView("新版本已就绪 ${note.versionName}".trim(), note.lines)
            Row(Modifier.padding(start = 20.dp, bottom = 24.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                PillButton("安装", ButtonStyle.Primary, onClick = onInstall)
                PillButton("稍后", ButtonStyle.Plain, onClick = onLater)
            }
        }
    }
}
