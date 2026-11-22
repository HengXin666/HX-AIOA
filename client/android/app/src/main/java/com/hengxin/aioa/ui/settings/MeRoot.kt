package com.hengxin.aioa.ui.settings

import android.content.Context
import android.net.Uri
import android.os.PowerManager
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.hengxin.aioa.R
import com.hengxin.aioa.config.Auth
import com.hengxin.aioa.config.ConfigStore
import com.hengxin.aioa.config.ThemeMode
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Text

private const val NAME_SP = 18
private const val SUB_SP = 13

/** 根页摘要只读本机状态, 不碰 SettingsModel, 免得一进 "我的" 就拉起代理内核。 */
class MeSummary(
    val online: Boolean,
    val sources: Int?,
    val spaces: Int,
    val mode: ThemeMode,
)

/** 每次回到前台加一, 用来重读系统权限等外部状态 (用户可能刚从系统设置页回来)。 */
@Composable
fun rememberResumeTick(): Int {
    var tick by remember { mutableIntStateOf(0) }
    val owner = LocalLifecycleOwner.current
    DisposableEffect(owner) {
        val observer = LifecycleEventObserver { _, e -> if (e == Lifecycle.Event.ON_RESUME) tick++ }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer) }
    }
    return tick
}

fun appVersion(context: Context): String =
    runCatching { context.packageManager.getPackageInfo(context.packageName, 0).versionName }.getOrNull().orEmpty()

fun serverHost(raw: String): String = raw.trim().takeIf { it.isNotEmpty() }?.let { Uri.parse(it).host ?: it }.orEmpty()

fun notificationsOn(context: Context) = NotificationManagerCompat.from(context).areNotificationsEnabled()

fun batteryWhitelisted(context: Context) =
    context.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(context.packageName)

/** "我的" 根页: 顶部账号卡 + 分组列表; selected 用于平板两栏时高亮右侧正在看的项。 */
@Composable
fun MeRoot(summary: MeSummary, selected: SettingsPage?, open: (SettingsPage) -> Unit, openWorkspace: () -> Unit) {
    val context = LocalContext.current
    val tick = rememberResumeTick()
    val config = remember(tick, summary.online) { ConfigStore.load(context) }
    val notify = remember(tick) { notificationsOn(context) }
    val account = remember(tick, summary.online) { Auth.load(context) }
    val battery = remember(tick) { batteryWhitelisted(context) }
    val version = remember { appVersion(context) }
    val host = serverHost(config?.server.orEmpty())
    SettingsPageFrame(SettingsPage.ROOT.title, null) {
        val who = account?.let { it.display.ifEmpty { it.name } }
        AccountCard(who, host, summary.online, selected == SettingsPage.ACCOUNT) { open(SettingsPage.ACCOUNT) }
        SettingsGroup("数据") {
            PageRow(SettingsPage.SOURCES, summary.sources?.let { "$it 个" }.orEmpty(), selected, open)
            RowDivider()
            PageRow(SettingsPage.INTEGRATIONS, "", selected, open)
            RowDivider()
            NavRow(WORKSPACE_ICON, WORKSPACE_TITLE, if (summary.spaces > 0) "${summary.spaces} 个" else "未下发", onClick = openWorkspace)
        }
        SettingsGroup("连接") {
            PageRow(SettingsPage.ACCOUNT, account?.let { it.display.ifEmpty { it.name } } ?: "未登录", selected, open)
            if (account?.role == "owner" || account?.role == "admin") {
                RowDivider()
                PageRow(SettingsPage.MEMBERS, "", selected, open)
            }
            RowDivider()
            PageRow(SettingsPage.SERVER, host.ifEmpty { "未配置" }, selected, open)
            RowDivider()
            PageRow(SettingsPage.PROXY, if (config?.proxyEnabled == true) "订阅" else TEXT_DIRECT, selected, open)
            RowDivider()
            PageRow(SettingsPage.LINK_LOG, "", selected, open)
        }
        SettingsGroup("通知") { PageRow(SettingsPage.NOTIFY, if (notify) TEXT_ON else TEXT_OFF, selected, open) }
        SettingsGroup("外观") { PageRow(SettingsPage.APPEARANCE, summary.mode.label, selected, open) }
        SettingsGroup("系统") {
            PageRow(SettingsPage.SYSTEM, if (battery) "已加白名单" else "待设置", selected, open)
            RowDivider()
            PageRow(SettingsPage.UPDATE, version, selected, open)

        }
        SettingsGroup { PageRow(SettingsPage.ABOUT, "", selected, open) }
    }
}

@Composable
private fun PageRow(page: SettingsPage, value: String, selected: SettingsPage?, open: (SettingsPage) -> Unit) {
    NavRow(page.icon, page.title, value, selected == page) { open(page) }
}

@Composable
private fun AccountCard(who: String?, host: String, online: Boolean, selected: Boolean, onClick: () -> Unit) {
    val c = Aioa.colors
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(Aioa.metrics.radius))
            .background(if (selected) c.surfaceAlt else c.surface).clickable(onClick = onClick).padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Image(
            painterResource(R.drawable.about_art),
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier.size(56.dp).clip(CircleShape),
        )
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(who ?: stringResource(R.string.app_name), c.text, NAME_SP, weight = FontWeight.SemiBold)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                StatusDot(online)
                val state = stringResource(if (online) R.string.status_online else R.string.status_offline)
                Text(if (host.isEmpty()) state else "$state · $host", c.textSecondary, SUB_SP)
            }
        }
    }
}
