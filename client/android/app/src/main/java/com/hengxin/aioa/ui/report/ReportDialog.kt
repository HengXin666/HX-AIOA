package com.hengxin.aioa.ui.report

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.ui.ChatModel

/** 周报整页叠在当前界面之上 (总览入口进入), 返回键或左上返回关掉; 不动外壳的导航状态。 */
@Composable
fun WeeklyReportDialog(chat: ChatModel, onClose: () -> Unit) {
    Dialog(onClose, DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Box(Modifier.fillMaxSize().background(Aioa.colors.background).safeDrawingPadding()) { WeeklyReport(chat, onClose) }
    }
}
