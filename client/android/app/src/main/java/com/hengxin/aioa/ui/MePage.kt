package com.hengxin.aioa.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalContext
import com.hengxin.aioa.config.AppearancePrefs
import com.hengxin.aioa.config.ThemeMode
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.AppearanceEditor
import com.hengxin.aioa.kit.Card
import com.hengxin.aioa.kit.Chip
import com.hengxin.aioa.kit.Group
import com.hengxin.aioa.kit.SettingRow

/** 我的: 外观 (明暗, 主题色, 圆角, 密度) + 进入连接与代理设置 + 版本与历史公告。 */
@Composable
fun MePage(prefs: AppearancePrefs, setPrefs: (AppearancePrefs) -> Unit, onNotes: () -> Unit, onSettings: () -> Unit) {
    val context = LocalContext.current
    val version = runCatching { context.packageManager.getPackageInfo(context.packageName, 0).versionName }.getOrNull()
    PageColumn("我的") {
        PageSection("外观")
        Card {
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Group("明暗") { ThemeMode.entries.forEach { m -> Chip(m.label, prefs.mode == m) { setPrefs(prefs.copy(mode = m)) } } }
                AppearanceEditor(prefs.resolve(Aioa.tokens.dark)) { setPrefs(prefs.with(it)) }
            }
        }
        PageSection("通用")
        Card {
            SettingRow("plug", "连接与代理", "服务端, 订阅, 通知", onSettings)
            SettingRow("refresh-cw", "版本与更新公告", version.orEmpty(), onNotes)
        }
    }
}
