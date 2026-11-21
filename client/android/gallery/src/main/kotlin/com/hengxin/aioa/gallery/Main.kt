package com.hengxin.aioa.gallery

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.application
import androidx.compose.ui.window.rememberWindowState
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.AioaTheme
import com.hengxin.aioa.kit.AppScaffold
import com.hengxin.aioa.kit.Appearance
import com.hengxin.aioa.kit.AppearanceEditor
import com.hengxin.aioa.kit.Chip
import com.hengxin.aioa.kit.Group
import com.hengxin.aioa.kit.NavItem
import com.hengxin.aioa.kit.Text

/** 预览设备, 尺寸为逻辑分辨率 (dp)。 */
enum class Device(val title: String, val size: DpSize) {
    PHONE("手机", DpSize(390.dp, 844.dp)),
    TABLET_PORTRAIT("平板竖屏", DpSize(800.dp, 1280.dp)),
    TABLET_LANDSCAPE("平板横屏", DpSize(1280.dp, 800.dp)),
}

private val NAV = listOf(
    NavItem("overview", "总览", "gauge"),
    NavItem("chat", "消息", "message-circle"),
    NavItem("res", "资源", "server"),
    NavItem("me", "我的", "user"),
)
private val STAGE = DpSize(820.dp, 880.dp)

fun main() = application {
    Window(
        onCloseRequest = ::exitApplication,
        title = "HX-AIOA 组件画廊",
        state = rememberWindowState(size = DpSize(1200.dp, 960.dp)),
    ) {
        var appearance by remember { mutableStateOf(Appearance()) }
        var page by remember { mutableStateOf(Page.OVERVIEW) }
        var device by remember { mutableStateOf(Device.PHONE) }
        AioaTheme(appearance) {
            Row(Modifier.fillMaxSize().background(Aioa.colors.surfaceAlt).padding(24.dp), horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                Controls(appearance, { appearance = it }, page, { page = it }, device, { device = it })
                Phone(device) { page.content() }
            }
        }
    }
}

/** 设备外框: 按真实逻辑分辨率排版, 放不下时整体等比缩小显示。 */
@Composable
fun Phone(device: Device, content: @Composable () -> Unit) {
    val scale = minOf(1f, STAGE.width / device.size.width, STAGE.height / device.size.height)
    val shape = RoundedCornerShape(36.dp * scale)
    val outer = LocalDensity.current
    Box(
        Modifier.size(device.size * scale).clip(shape).border(6.dp * scale, Color(0xFF111111), shape)
            .padding(6.dp * scale),
    ) {
        CompositionLocalProvider(LocalDensity provides Density(outer.density * scale, outer.fontScale)) {
            Screen(content)
        }
    }
}

@Composable
fun Screen(content: @Composable () -> Unit) {
    var tab by remember { mutableStateOf(NAV.first().key) }
    AppScaffold(NAV, tab, { tab = it }) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 20.dp)) {
            content()
        }
    }
}

/** 左侧调节区: 明暗, 主题色, 圆角, 密度, 页面。改动即时生效。 */
@Composable
private fun Controls(
    a: Appearance,
    set: (Appearance) -> Unit,
    page: Page,
    setPage: (Page) -> Unit,
    device: Device,
    setDevice: (Device) -> Unit,
) {
    val c = Aioa.colors
    Column(Modifier.width(280.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
        Text("组件画廊", c.text, 22)
        Group("页面") { Page.entries.forEach { Chip(it.title, it == page) { setPage(it) } } }
        Group("设备") { Device.entries.forEach { Chip(it.title, it == device) { setDevice(it) } } }
        Group("明暗") {
            Chip("明亮", !a.dark) { set(a.copy(dark = false)) }
            Chip("黑夜", a.dark) { set(a.copy(dark = true)) }
        }
        AppearanceEditor(a, set)
        Text("改代码后窗口自动刷新 (热重载)。按住图表可看数值。", c.textSecondary, 12)
    }
}

