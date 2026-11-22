package com.hengxin.aioa.ui.settings

import android.app.Application
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import com.hengxin.aioa.Constants
import com.hengxin.aioa.config.AppConfig
import com.hengxin.aioa.config.Auth
import com.hengxin.aioa.config.ConfigStore
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.link.LinkService
import com.hengxin.aioa.net.Api
import com.hengxin.aioa.ui.SettingsModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private const val DELETE = "DELETE"
private const val GET = "GET"

private data class Device(val id: String, val name: String, val platform: String, val current: Boolean)

private fun roleLabel(role: String): String = when (role) {
    "owner" -> "母号"
    "admin" -> "管理员"
    else -> "成员"
}

/** 账号: 未登录时账号密码登录; 已登录显示身份, 设备列表 (可吊销), 退出登录。 */
@Composable
fun AccountPage(model: SettingsModel, onChanged: () -> Unit, onBack: (() -> Unit)?) {
    val context = LocalContext.current
    val app = context.applicationContext as Application
    val scope = rememberCoroutineScope()
    var tick by remember { mutableIntStateOf(0) }
    val session = remember(tick) { Auth.load(context) }
    var name by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }
    var devices by remember { mutableStateOf<List<Device>>(emptyList()) }
    val c = Aioa.colors

    // 登录状态变化后让常驻连接与界面连接都换上新凭证
    val changed = {
        LinkService.start(app, Constants.ACTION_RELOAD)
        onChanged()
        tick++
    }

    LaunchedEffect(session?.session) {
        if (session == null) return@LaunchedEffect
        val r = withContext(Dispatchers.IO) { Api.call(context, GET, listOf(Constants.ME_PATH)) }
        val arr = r.body?.optJSONArray("devices")
        devices = (0 until (arr?.length() ?: 0)).mapNotNull { arr?.optJSONObject(it) }.map {
            Device(it.optString("id"), it.optString("name"), it.optString("platform"), it.optBoolean("current"))
        }
        if (r.error != null) message = r.error
    }

    SettingsPageFrame(SettingsPage.ACCOUNT.title, onBack) {
        if (session == null) {
            SettingsGroup("登录", "先在 \"服务端\" 填好地址。登录后用账号凭证连接, 旧令牌可以留空。") {
                InputRow("用户名", name, "例如 Heng_Xin") { name = it }
                RowDivider(false)
                InputRow("密码", password, "至少 8 位", secret = true) { password = it }
            }
            PrimaryAction(if (busy) "登录中..." else "登录", enabled = !busy && name.isNotBlank() && password.isNotEmpty()) {
                val server = model.server.trim()
                if (server.isEmpty()) {
                    message = "请先在 \"服务端\" 填写服务端地址"
                    return@PrimaryAction
                }
                busy = true
                message = ""
                scope.launch {
                    val r = withContext(Dispatchers.IO) {
                        val reply = Auth.login(app, server, name, password)
                        // 首次只填了地址没填令牌时, 登录成功后补存地址
                        if (reply.session != null && ConfigStore.load(app)?.server != server) {
                            ConfigStore.save(app, AppConfig(server, model.token.trim(), model.subscription.trim(), model.proxyLink))
                        }
                        reply
                    }
                    busy = false
                    if (r.session != null) {
                        password = ""
                        message = "已登录 ${r.session.display.ifEmpty { r.session.name }}"
                        changed()
                    } else message = r.error ?: "登录失败"
                }
            }
        } else {
            SettingsGroup("当前账号") {
                InfoRow("用户名", session.name)
                RowDivider(false)
                InfoRow("显示名", session.display.ifEmpty { session.name })
                RowDivider(false)
                InfoRow("角色", roleLabel(session.role))
            }
            if (devices.isNotEmpty()) {
                SettingsGroup("已登录的设备", "吊销后该设备立即下线, 需要重新登录。") {
                    devices.forEachIndexed { i, d ->
                        if (i > 0) RowDivider()
                        val label = "${d.name} · ${d.platform}"
                        if (d.current) InfoRow(label, "本机", c.success)
                        else ActionRow(label, value = "吊销", danger = true) {
                            scope.launch {
                                val r = withContext(Dispatchers.IO) { Api.call(context, DELETE, listOf(Constants.ME_DEVICES_PATH, d.id)) }
                                if (r.error != null) message = r.error else devices = devices.filter { it.id != d.id }
                            }
                        }
                    }
                }
            }
            SettingsGroup {
                ActionRow("退出登录", danger = true, enabled = !busy) {
                    busy = true
                    scope.launch {
                        withContext(Dispatchers.IO) { ConfigStore.load(app)?.let { Auth.logout(app, it) } ?: Auth.clear(app) }
                        busy = false
                        devices = emptyList()
                        message = "已退出登录"
                        changed()
                    }
                }
            }
        }
        if (message.isNotEmpty()) SettingsGroup { NoteRow(message, c.textSecondary) }
    }
}
