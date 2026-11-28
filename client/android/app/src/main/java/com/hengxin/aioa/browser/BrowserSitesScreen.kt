package com.hengxin.aioa.browser

import android.content.Context
import android.graphics.BitmapFactory
import android.widget.Toast
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.ui.settings.ActionRow
import com.hengxin.aioa.ui.settings.InfoRow
import com.hengxin.aioa.ui.settings.InputRow
import com.hengxin.aioa.ui.settings.NoteRow
import com.hengxin.aioa.ui.settings.RowDivider
import com.hengxin.aioa.ui.settings.SettingsGroup
import com.hengxin.aioa.ui.settings.SettingsPageFrame
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private const val NOTE = "只列出在内置浏览器里打开过的网站; 登录态是否仍有效以网站为准。记录只存在本机。"
private const val EMPTY = "还没有记录。在内置浏览器里打开网站后, 有 Cookie 的会出现在这里。"
private const val ALL_TEXT = "清除内置浏览器里所有网站的 Cookie 与本地存储, 包括不在列表里的。之后要重新登录; 代理或集成登录 (如 Cloudflare, GitHub) 用到的登录也会失效。"
private const val SHARED_HINT = "这个网站可能被代理或集成登录用到, 相关功能需要重新登录"
private const val LOGOUT = "退出这个网站"
private const val LOGOUT_ALL = "全部退出"
private const val SEARCH_MIN = 8
private const val NAME_SP = 15
private const val SUB_SP = 12
private const val MENU_SP = 15
private val ICON_BOX = 32.dp

/** 网站与登录 (#143): 分组列出浏览器记过的站点, 可打开, 退出, 忘记。 */
@Composable
fun SitesPage(current: String?, tick: Int, onBack: () -> Unit, open: (SiteRecord) -> Unit) {
    val context = LocalContext.current
    var rev by remember { mutableIntStateOf(0) }
    var records by remember { mutableStateOf(emptyList<SiteRecord>()) }
    var query by remember { mutableStateOf("") }
    var confirmAll by remember { mutableStateOf(false) }
    LaunchedEffect(tick, rev) { records = withContext(Dispatchers.IO) { SiteStore.list(context.applicationContext) } }
    val groups = SiteRules.arrange(records, current, query)
    val now = System.currentTimeMillis()
    val act = SiteRowActions(
        open = open,
        logout = { logout(context, it); rev++ },
        forget = { SiteStore.forget(context.applicationContext, it.site); rev++ },
    )
    SettingsPageFrame(SITES_TITLE, onBack) {
        SettingsGroup(footer = NOTE) {
            InfoRow("网站", "${records.size} 个, 已登录 ${records.count { it.login }} 个")
            RowDivider(indent = false)
            ActionRow(LOGOUT_ALL, danger = true, enabled = records.isNotEmpty()) { confirmAll = true }
        }
        if (records.size > SEARCH_MIN) SettingsGroup { InputRow("搜索", query, "域名或标题") { query = it } }
        if (records.isEmpty()) SettingsGroup { NoteRow(EMPTY, Aioa.colors.textSecondary) }
        SiteSection("当前网站", groups.current, now, act)
        SiteSection("已登录", groups.login, now, act)
        SiteSection("访问过", groups.visited, now, act)
    }
    if (confirmAll) {
        AlertDialog(
            onDismissRequest = { confirmAll = false },
            title = { androidx.compose.material3.Text("$LOGOUT_ALL?") },
            text = { androidx.compose.material3.Text(ALL_TEXT) },
            confirmButton = {
                TextButton({
                    confirmAll = false
                    SiteSession.logoutAll(context.applicationContext) { rev++ }
                }) { androidx.compose.material3.Text(LOGOUT_ALL, color = Aioa.colors.danger) }
            },
            dismissButton = { TextButton({ confirmAll = false }) { androidx.compose.material3.Text("取消") } },
        )
    }
}

private class SiteRowActions(val open: (SiteRecord) -> Unit, val logout: (SiteRecord) -> Unit, val forget: (SiteRecord) -> Unit)

private fun logout(context: Context, r: SiteRecord) {
    SiteSession.logout(context.applicationContext, r)
    val text = if (SiteRules.isShared(r.site)) SHARED_HINT else "已退出 ${SiteRules.display(r.site)}"
    Toast.makeText(context, text, Toast.LENGTH_SHORT).show()
}

@Composable
private fun SiteSection(title: String, list: List<SiteRecord>, now: Long, act: SiteRowActions) {
    if (list.isEmpty()) return
    SettingsGroup("$title (${list.size})") {
        list.forEachIndexed { i, r ->
            if (i > 0) RowDivider()
            SiteRow(r, now, act)
        }
    }
}

@Composable
private fun SiteRow(r: SiteRecord, now: Long, act: SiteRowActions) {
    val c = Aioa.colors
    var menu by remember { mutableStateOf(false) }
    Row(
        Modifier.fillMaxWidth().clickable { act.open(r) }.heightIn(min = 56.dp).padding(start = 16.dp, end = 4.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        SiteIcon(r)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(SiteRules.display(r.site), c.text, NAME_SP)
            val title = r.title.takeIf { it.isNotBlank() }?.let { "$it · " }.orEmpty()
            Text("$title${SiteRules.ago(r.last, now)} · ${r.cookies} 个 Cookie", c.textSecondary, SUB_SP)
        }
        Box {
            Box(Modifier.size(40.dp).clip(CircleShape).clickable { menu = true }, contentAlignment = Alignment.Center) {
                Icon("ellipsis", c.textSecondary, 18.dp)
            }
            DropdownMenu(menu, { menu = false }) {
                DropdownMenuItem({ Text(LOGOUT, c.danger, MENU_SP) }, { menu = false; act.logout(r) })
                DropdownMenuItem({ Text("忘记记录", c.text, MENU_SP) }, { menu = false; act.forget(r) })
            }
        }
    }
}

@Composable
private fun SiteIcon(r: SiteRecord) {
    val c = Aioa.colors
    val context = LocalContext.current
    val icon by produceState<ImageBitmap?>(null, r.site, r.last) {
        value = withContext(Dispatchers.IO) {
            runCatching { BitmapFactory.decodeFile(SiteStore.iconFile(context, r.site).path)?.asImageBitmap() }.getOrNull()
        }
    }
    Box(
        Modifier.size(ICON_BOX).clip(RoundedCornerShape(8.dp)).background(c.surfaceAlt),
        contentAlignment = Alignment.Center,
    ) {
        val img = icon
        if (img != null) Image(img, null, Modifier.size(20.dp)) else Icon(if (r.login) "key-round" else "globe", c.textSecondary, 18.dp)
    }
}
