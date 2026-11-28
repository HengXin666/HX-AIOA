package com.hengxin.aioa.ui.settings

import android.app.Application
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.net.ApiCache
import com.hengxin.aioa.net.ErrKind
import com.hengxin.aioa.ui.ErrorNote
import com.hengxin.aioa.ui.chat.AvatarUploads
import com.hengxin.aioa.ui.chat.UploadingAvatar
import com.hengxin.aioa.ui.chat.rememberAvatarPicker
import com.hengxin.aioa.ui.chat.ChatAvatar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
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
import org.json.JSONObject

private const val DELETE = "DELETE"
private const val GET = "GET"
private const val POST = "POST"
private const val PASSWORD_MIN = 8
private const val PATCH = "PATCH"
private const val SETTING_AVATAR = "avatar"
private val ACCOUNT_AVATAR = 72.dp

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
    var oldPw by remember { mutableStateOf("") }
    var newPw by remember { mutableStateOf("") }
    val c = Aioa.colors
    // 账号头像与侧栏, 我的页账号卡同一来源 (#144): 账号上的 user.avatar, 没有用旧设置里的
    val avatar by com.hengxin.aioa.data.Me.face.collectAsState()
    // 上传在应用级作用域里跑 (#125): 离开页面继续, 回来接着看进度与结果
    val job = AvatarUploads.jobs[AvatarUploads.ME]
    val upload = { bytes: ByteArray ->
        AvatarUploads.start(context, AvatarUploads.ME, bytes) { id ->
            // 账号头像走 PATCH /me (#139): 成员列表, 资料卡读的是账号上的 avatar; settings 里那份留给旧版客户端
            withContext(Dispatchers.IO) {
                Api.call(app, PATCH, listOf(Constants.ME_PATH), JSONObject().put(SETTING_AVATAR, id)).error
                    ?.also { return@withContext it }
                Api.call(app, PATCH, listOf(Constants.SETTINGS_PATH), JSONObject().put(SETTING_AVATAR, id))
                null
            }
        }
    }
    val pickAvatar = rememberAvatarPicker({ message = it }) { upload(it) }
    LaunchedEffect(job?.done) {
        val id = job?.done ?: return@LaunchedEffect
        com.hengxin.aioa.data.Me.setAvatar(app, id)
        message = "头像已更新"
        AvatarUploads.clear(AvatarUploads.ME)
    }

    // 登录状态变化后让常驻连接与界面连接都换上新凭证
    val changed = {
        LinkService.start(app, Constants.ACTION_RELOAD)
        onChanged()
        tick++
    }

    LaunchedEffect(session?.session) {
        if (session == null) return@LaunchedEffect
        withContext(Dispatchers.IO) {
            ApiCache.get(context, "settings", listOf(Constants.SETTINGS_PATH)) { body, _ ->
                val s = body.optJSONObject("settings")
                val id = s?.optString(SETTING_AVATAR)?.takeIf { !s.isNull(SETTING_AVATAR) && it.isNotEmpty() }
                withContext(Dispatchers.Main) { com.hengxin.aioa.data.Me.setSettingsAvatar(app, id) }
            }
        }
        val r = withContext(Dispatchers.IO) { Api.call(context, GET, listOf(Constants.ME_PATH)) }
        r.body?.optJSONObject("user")?.let { u -> com.hengxin.aioa.data.Me.setAvatar(app, u.optString(SETTING_AVATAR).takeIf { !u.isNull(SETTING_AVATAR) && it.isNotEmpty() }) }
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
                        // 登录时填的地址与已存的不同, 登录成功后补存地址
                        if (reply.session != null && ConfigStore.read(app)?.server != server) {
                            ConfigStore.save(app, AppConfig(server, model.subscription.trim(), model.proxyLink))
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
            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    UploadingAvatar(job, ACCOUNT_AVATAR, Modifier.clickable(enabled = job?.running != true) { pickAvatar() }) {
                        ChatAvatar(session.name, avatar, ACCOUNT_AVATAR)
                    }
                    Text("点头像更换", fontSize = 12.sp, color = c.textSecondary, modifier = Modifier.padding(top = 4.dp))
                    job?.error?.let { e ->
                        ErrorNote("头像上传失败: $e", Modifier.padding(top = 6.dp), kind = job.kind ?: ErrKind.guess(e), onRetry = { upload(job.bytes) }, onDismiss = { AvatarUploads.clear(AvatarUploads.ME) })
                    }
                }
            }
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
            SettingsGroup("修改密码", "改完后其它设备都会下线, 本机保持登录。") {
                InputRow("原密码", oldPw, "", secret = true) { oldPw = it }
                RowDivider(false)
                InputRow("新密码", newPw, "至少 8 位", secret = true) { newPw = it }
                RowDivider()
                ActionRow(if (busy) "提交中..." else "修改密码", enabled = !busy && oldPw.isNotEmpty() && newPw.length >= PASSWORD_MIN) {
                    busy = true
                    scope.launch {
                        val body = JSONObject().put("old", oldPw).put("new", newPw)
                        val r = withContext(Dispatchers.IO) { Api.call(context, POST, listOf(Constants.ME_PASSWORD_PATH), body) }
                        busy = false
                        if (r.error != null) message = r.error
                        else {
                            oldPw = ""
                            newPw = ""
                            devices = devices.filter { it.current }
                            message = "密码已修改, 其它设备已下线"
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
