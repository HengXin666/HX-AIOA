package com.hengxin.aioa.browser

import android.net.Uri
import android.view.ViewGroup
import android.webkit.WebView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.pressable

class BrowserActions(
    val close: () -> Unit,
    val load: (String) -> Unit,
    val reloadOrStop: () -> Unit,
    val copy: () -> Unit,
    val external: () -> Unit,
    val forceDark: () -> Unit,
    val sites: () -> Unit,
    val darkSupported: Boolean,
)

private const val ADDRESS_SP = 14
private const val HINT_SP = 12
private const val PROGRESS_MAX = 100f
private const val MENU_SP = 15
private val MENU_ICON = 18.dp
private val BAR_ICON = 20.dp

@Composable
fun BrowserScreen(web: WebView, page: PageState, actions: BrowserActions) {
    val c = Aioa.colors
    Column(Modifier.fillMaxSize().background(c.background).systemBarsPadding().imePadding()) {
        AddressBar(page, actions)
        Box(Modifier.fillMaxWidth().height(2.dp)) {
            if (page.loading) Box(Modifier.fillMaxWidth(page.progress / PROGRESS_MAX).height(2.dp).background(c.accent))
        }
        // 换主题时 WebView 会换一个新的, 按实例重建
        key(web) {
            AndroidView(
                factory = { web.apply { (parent as? ViewGroup)?.removeView(this); layoutParams = ViewGroup.LayoutParams(-1, -1) } },
                modifier = Modifier.weight(1f).fillMaxWidth(),
            )
        }
        BottomBar(web, page, actions)
    }
}

@Composable
private fun AddressBar(page: PageState, actions: BrowserActions) {
    val c = Aioa.colors
    val focus = LocalFocusManager.current
    var editing by remember { mutableStateOf(false) }
    var field by remember { mutableStateOf(TextFieldValue("")) }
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        BarIcon("x", c.text, actions.close)
        Box(
            Modifier.weight(1f).clip(RoundedCornerShape(Aioa.metrics.radius)).background(c.surfaceAlt).padding(horizontal = 12.dp, vertical = 8.dp),
        ) {
            BasicTextField(
                value = if (editing) field else TextFieldValue(display(page)),
                onValueChange = { field = it },
                singleLine = true,
                textStyle = TextStyle(color = c.text, fontSize = ADDRESS_SP.sp),
                cursorBrush = SolidColor(c.accent),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
                keyboardActions = KeyboardActions(onGo = {
                    if (field.text.isNotBlank()) actions.load(field.text)
                    focus.clearFocus()
                }),
                modifier = Modifier.fillMaxWidth().onFocusChanged {
                    // 进入编辑时显示完整地址并全选, 方便直接输入新地址或搜索词
                    if (it.isFocused && !editing) field = TextFieldValue(page.url, TextRange(0, page.url.length))
                    editing = it.isFocused
                },
            )
        }
        BarIcon(if (page.loading) "x" else "refresh-cw", c.text, actions.reloadOrStop)
    }
}

@Composable
private fun BottomBar(web: WebView, page: PageState, actions: BrowserActions) {
    val c = Aioa.colors
    Row(
        Modifier.fillMaxWidth().background(c.surface).padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        BarIcon("chevron-left", tint(page.canBack)) { if (web.canGoBack()) web.goBack() }
        BarIcon("chevron-right", tint(page.canForward)) { if (web.canGoForward()) web.goForward() }
        Row(Modifier.weight(1f), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
            Icon(if (page.proxied) "globe" else "shield-off", c.textSecondary, 14.dp)
            Text(status(page), c.textSecondary, HINT_SP, Modifier.padding(start = 4.dp))
        }
        Box {
            var menu by remember { mutableStateOf(false) }
            BarIcon("ellipsis", c.text) { menu = true }
            DropdownMenu(menu, { menu = false }) {
                val item: @Composable (String, String, () -> Unit) -> Unit = { label, icon, run ->
                    DropdownMenuItem({ Text(label, c.text, MENU_SP) }, { menu = false; run() }, leadingIcon = { Icon(icon, c.text, MENU_ICON) })
                }
                item("复制链接", "copy", actions.copy)
                item("用其他应用打开", "external-link", actions.external)
                if (actions.darkSupported && page.url.isNotEmpty()) {
                    DropdownMenuItem(
                        { Text("此站强制深色", c.text, MENU_SP) },
                        { menu = false; actions.forceDark() },
                        leadingIcon = { Icon("moon", c.text, MENU_ICON) },
                        trailingIcon = { Icon(if (page.forceDark) "square-check" else "square", if (page.forceDark) c.accent else c.textSecondary, MENU_ICON) },
                    )
                }
                item(SITES_TITLE, "key-round", actions.sites)
            }
        }
    }
}

@Composable
private fun tint(enabled: Boolean): Color = if (enabled) Aioa.colors.text else Aioa.colors.textSecondary.copy(alpha = 0.4f)

@Composable
private fun BarIcon(name: String, tint: Color, onClick: () -> Unit) {
    Box(Modifier.size(36.dp).pressable(onClick), contentAlignment = Alignment.Center) { Icon(name, tint, BAR_ICON) }
}

// 不编辑时只显示域名 + 标题, 更像浏览器的样子
private fun display(page: PageState): String {
    val host = runCatching { Uri.parse(page.url).host }.getOrNull().orEmpty().removePrefix("www.")
    return when {
        host.isEmpty() -> page.url
        page.title.isBlank() || page.title == page.url -> host
        else -> "$host | ${page.title}"
    }
}

private fun status(page: PageState): String {
    val route = if (page.proxied) "代理" else "直连"
    return if (page.blocked > 0) "$route | 拦截 ${page.blocked}" else route
}
