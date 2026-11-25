package com.hengxin.aioa.ui.settings

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import com.hengxin.aioa.Constants
import com.hengxin.aioa.config.Auth
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.net.Api
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private const val GET = "GET"
private const val POST = "POST"
private const val PATCH = "PATCH"
private const val DELETE = "DELETE"
private const val ROLE_MEMBER = "member"
private const val STATUS_ACTIVE = "active"
private const val STATUS_PENDING = "pending"
private const val STATUS_DISABLED = "disabled"
private const val DEFAULT_HOURS = "72"
private const val MAX_HOURS = 30 * 24

private data class Member(val id: String, val name: String, val display: String, val role: String, val status: String)
private data class Invite(val id: String, val role: String, val expires: Long, val needsApproval: Boolean)

private fun objects(a: JSONArray?) = (0 until (a?.length() ?: 0)).mapNotNull { a?.optJSONObject(it) }

private fun parseMembers(body: JSONObject?) = objects(body?.optJSONArray("users")).map {
    Member(it.optString("id"), it.optString("name"), it.optString("display"), it.optString("role"), it.optString("status"))
}

private fun parseInvites(body: JSONObject?) = objects(body?.optJSONArray("invites"))
    .map { Invite(it.optString("id"), it.optString("role"), it.optLong("expires"), it.optBoolean("needsApproval")) }
    .filter { it.expires > System.currentTimeMillis() }

private fun roleText(role: String) = when (role) {
    ROLE_OWNER -> "母号"
    ROLE_ADMIN -> "管理员"
    else -> "成员"
}

private fun statusText(status: String) = when (status) {
    STATUS_PENDING -> "待审批"
    STATUS_DISABLED -> "已停用"
    else -> "正常"
}

private fun clock(ms: Long) = SimpleDateFormat("MM-dd HH:mm", Locale.CHINA).format(Date(ms))

// 只能在后台线程调用
private fun call(context: Context, method: String, segments: List<String>, body: JSONObject? = null) =
    Api.call(context, method, segments, body)

/** 成员与邀请: 管理员看成员数, 审批/停用成员, 生成和撤销邀请码。母号可以邀请管理员。 */
@Composable
fun MembersPage(onBack: (() -> Unit)?) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    val isOwner = remember { Auth.load(context)?.role == ROLE_OWNER }
    var members by remember { mutableStateOf<List<Member>?>(null) }
    var invites by remember { mutableStateOf<List<Invite>>(emptyList()) }
    var message by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var asAdmin by remember { mutableStateOf(false) }
    var approval by remember { mutableStateOf(false) }
    var hours by remember { mutableStateOf(DEFAULT_HOURS) }
    var code by remember { mutableStateOf("") }
    val c = Aioa.colors

    val reload: () -> Unit = {
        scope.launch {
            val (u, i) = withContext(Dispatchers.IO) {
                call(context, GET, listOf(Constants.USERS_PATH)) to call(context, GET, listOf(Constants.INVITES_PATH))
            }
            u.error?.let { message = it } ?: run { members = parseMembers(u.body) }
            if (i.error == null) invites = parseInvites(i.body)
        }
    }
    // 执行一个管理动作, 成功后刷新列表
    val act: (List<String>, String, JSONObject?, String) -> Unit = { path, method, body, done ->
        scope.launch {
            val r = withContext(Dispatchers.IO) { call(context, method, path, body) }
            message = r.error ?: done
            if (r.error == null) reload()
        }
    }
    LaunchedEffect(Unit) { reload() }

    SettingsPageFrame(SettingsPage.MEMBERS.title, onBack) {
        val list = members
        SettingsGroup("成员", list?.let { "共 ${it.size} 人, 待审批 ${it.count { m -> m.status == STATUS_PENDING }} 人。点右侧操作审批或停用。" }) {
            if (list == null) NoteRow("加载中...", c.textSecondary)
            list?.forEachIndexed { i, m ->
                if (i > 0) RowDivider()
                val label = "${m.display.ifEmpty { m.name }} (${m.name}) · ${roleText(m.role)}"
                when {
                    m.role == ROLE_OWNER -> InfoRow(label, statusText(m.status))
                    m.status == STATUS_PENDING -> ActionRow(label, value = "通过审批") {
                        act(listOf(Constants.USERS_PATH, m.id, "approve"), POST, null, "已通过 ${m.name}")
                    }
                    m.status == STATUS_DISABLED -> ActionRow(label, value = "已停用, 点击启用") {
                        act(listOf(Constants.USERS_PATH, m.id), PATCH, JSONObject().put("status", STATUS_ACTIVE), "已启用 ${m.name}")
                    }
                    else -> ActionRow(label, value = "停用", danger = true) {
                        act(listOf(Constants.USERS_PATH, m.id), PATCH, JSONObject().put("status", STATUS_DISABLED), "已停用 ${m.name}, 其设备已下线")
                    }
                }
            }
        }
        SettingsGroup("邀请同学", "邀请码只能用一次。对方在 App 首次配置页填服务端地址, 邀请码, 自己的用户名和密码即可注册。") {
            if (isOwner) {
                SwitchRow("邀请为管理员", asAdmin) { asAdmin = it }
                RowDivider(false)
            }
            SwitchRow("注册后需要我审批", approval) { approval = it }
            RowDivider(false)
            InputRow("有效期 (小时)", hours, DEFAULT_HOURS) { hours = it.filter(Char::isDigit) }
            RowDivider()
            ActionRow(if (busy) "生成中..." else "生成邀请码", enabled = !busy) {
                busy = true
                val ttl = (hours.toIntOrNull() ?: DEFAULT_HOURS.toInt()).coerceIn(1, MAX_HOURS)
                val body = JSONObject().put("role", if (asAdmin) ROLE_ADMIN else ROLE_MEMBER).put("ttlHours", ttl).put("needsApproval", approval)
                scope.launch {
                    val r = withContext(Dispatchers.IO) { call(context, POST, listOf(Constants.INVITES_PATH), body) }
                    busy = false
                    code = r.body?.optString("code").orEmpty()
                    if (code.isNotEmpty()) {
                        clipboard.setText(AnnotatedString(code))
                        message = "邀请码已复制, 发给同学即可"
                        reload()
                    } else message = r.error ?: "生成失败"
                }
            }
            if (code.isNotEmpty()) {
                RowDivider()
                NoteRow(code, c.text, mono = true)
                ActionRow("再复制一次") { clipboard.setText(AnnotatedString(code)); message = "已复制" }
            }
        }
        if (invites.isNotEmpty()) {
            SettingsGroup("未使用的邀请", "撤销后邀请码立即失效。") {
                invites.forEachIndexed { i, inv ->
                    if (i > 0) RowDivider()
                    val label = "${roleText(inv.role)}${if (inv.needsApproval) " · 需审批" else ""} · ${clock(inv.expires)} 过期"
                    ActionRow(label, value = "撤销", danger = true) {
                        act(listOf(Constants.INVITES_PATH, inv.id), DELETE, null, "邀请已撤销")
                    }
                }
            }
        }
        if (message.isNotEmpty()) SettingsGroup { NoteRow(message, c.textSecondary) }
    }
}
