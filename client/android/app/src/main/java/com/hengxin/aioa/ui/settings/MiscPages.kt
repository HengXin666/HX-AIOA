package com.hengxin.aioa.ui.settings

import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.R
import com.hengxin.aioa.config.AppearancePrefs
import com.hengxin.aioa.config.ThemeMode
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.AppearanceEditor
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.Text

private const val ROW_SP = 15
private const val NAME_SP = 20
private val ART_MAX = 320.dp

private val MODE_ICONS = mapOf(ThemeMode.SYSTEM to "settings", ThemeMode.LIGHT to "sun", ThemeMode.DARK to "moon")

/** 外观: 明暗 (单选行), 主题色, 圆角, 密度与恢复默认 (组件库编辑器)。 */
@Composable
fun AppearancePage(prefs: AppearancePrefs, setPrefs: (AppearancePrefs) -> Unit, onBack: (() -> Unit)?) {
    SettingsPageFrame(SettingsPage.APPEARANCE.title, onBack) {
        SettingsGroup("明暗") {
            ThemeMode.entries.forEachIndexed { i, m ->
                if (i > 0) RowDivider()
                ChoiceRow(MODE_ICONS.getValue(m), m.label, prefs.mode == m) { setPrefs(prefs.copy(mode = m)) }
            }
        }
        SettingsGroup("样式", "改动立即生效并保存在本机。") {
            Box(Modifier.fillMaxWidth().padding(16.dp)) {
                AppearanceEditor(prefs.resolve(Aioa.tokens.dark)) { setPrefs(prefs.with(it)) }
            }
        }
        SettingsGroup("预览") {
            SwitchRow("新外壳", prefs.newShell, "侧栏 + 顶部标签, 去掉底栏 (#121); 只在手机宽度生效") { setPrefs(prefs.copy(newShell = it)) }
        }
    }
}

@Composable
private fun ChoiceRow(icon: String, title: String, selected: Boolean, onClick: () -> Unit) {
    val c = Aioa.colors
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).heightIn(min = 52.dp).padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(icon, c.text, 20.dp)
        Box(Modifier.weight(1f)) { Text(title, c.text, ROW_SP) }
        Box(Modifier.size(18.dp)) { if (selected) Icon(ICON_CHECK, c.text, 18.dp) }
    }
}

/** 关于: App 图片, 名称与版本, 简介, 仓库地址。 */
@Composable
fun AboutPage(onBack: (() -> Unit)?) {
    val c = Aioa.colors
    val context = LocalContext.current
    val version = remember { appVersion(context) }
    val name = stringResource(R.string.app_name)
    SettingsPageFrame(SettingsPage.ABOUT.title, onBack) {
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Image(
                painterResource(R.drawable.about_art),
                contentDescription = name,
                modifier = Modifier.widthIn(max = ART_MAX).fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(Aioa.metrics.radius)),
            )
            Text(name, c.text, NAME_SP, weight = FontWeight.SemiBold)
            Text(version, c.textSecondary, ROW_SP)
        }
        SettingsGroup { NoteRow(stringResource(R.string.about_desc)) }
        SettingsGroup {
            InfoRow("版本", version)
            RowDivider(false)
            InfoRow("仓库", stringResource(R.string.about_repo))
        }
    }
}
