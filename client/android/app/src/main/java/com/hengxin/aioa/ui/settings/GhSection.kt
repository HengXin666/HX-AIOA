package com.hengxin.aioa.ui.settings

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.browser.Browser
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Chip
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private const val SEC = 1000L
private const val DAY_MS = 86_400_000L
private val QUICK_DAYS = listOf(365 to "近一年", 90 to "近 90 天", 30 to "近 30 天")
private const val OPS_SHOWN = 10
private const val PAT_URL = "https://github.com/settings/personal-access-tokens/new"

private fun date(ts: Long) = SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(Date(ts))
private fun time(ts: Long) = SimpleDateFormat("MM-dd HH:mm", Locale.ROOT).format(Date(ts))

/** GitHub 授权插件的设置: 授权 (电脑上输码或贴令牌), 仓库范围, 哪些 Agent 能用, 操作记录。 */
@Composable
fun GhSection() {
    val c = Aioa.colors
    val api = GhApi(LocalContext.current)
    val scope = rememberCoroutineScope()
    var st by remember { mutableStateOf<GhStatus?>(null) }
    var repos by remember { mutableStateOf<List<GhRepo>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val reload: (Boolean) -> Unit = { fresh ->
        scope.launch {
            api.status().onSuccess { st = it; error = null }.onFailure { error = it.message }
            if (st?.auth != null) api.repos(fresh).onSuccess { repos = it }.onFailure { error = it.message }
        }
    }
    LaunchedEffect(Unit) { reload(false) }
    error?.let { SettingsGroup { NoteRow(it, c.danger) } }
    val s = st ?: return
    if (s.auth == null) return Authorize(api, s.device) { reload(true) }
    SettingsGroup("GitHub 账号", "令牌加密存在你的服务端, 不下发给手机和任何 Agent。") {
        InfoRow("账号", s.auth.login)
        RowDivider()
        InfoRow("方式", if (s.auth.kind == "pat") "令牌" else "设备码授权")
        s.auth.expires?.let { RowDivider(); InfoRow("令牌到期", time(it) + " (自动续期)") }
        RowDivider()
        ActionRow("撤销授权", "trash-2", danger = true) { scope.launch { api.revoke().onSuccess { repos = null; reload(false) }.onFailure { error = it.message } } }
    }
    RepoRules(s.rules) { r -> st = s.copy(rules = r); scope.launch { api.setRules(r).onSuccess { reload(false) }.onFailure { error = it.message } } }
    RepoList(repos, s.rules, { reload(true) }) { r -> scope.launch { api.setRules(r).onSuccess { reload(false) }.onFailure { error = it.message } } }
    if (s.agents.isNotEmpty()) SettingsGroup("能用它的 Agent", "声明了依赖的插件 Agent 默认打开, 其他默认关。") {
        s.agents.forEachIndexed { i, a ->
            if (i > 0) RowDivider()
            SwitchRow(a.name, a.allowed, a.channel + if (a.dep) " · 插件声明了依赖" else "") { on -> scope.launch { api.setAgent(a.keyId, on).onSuccess { reload(false) }.onFailure { error = it.message } } }
        }
    }
    if (s.ops.isNotEmpty()) SettingsGroup("最近操作") {
        s.ops.take(OPS_SHOWN).forEachIndexed { i, o ->
            if (i > 0) RowDivider()
            InfoRow("${o.by} ${o.op} ${o.repo.substringAfter('/')}${o.issue?.let { "#$it" } ?: ""}", time(o.ts) + if (o.ok) "" else " 失败", if (o.ok) null else c.danger)
        }
    }
}

/** 没授权时: 设备码 (在任何登录了 GitHub 的设备上输入) 或粘贴令牌。 */
@Composable
private fun Authorize(api: GhApi, device: Boolean, done: () -> Unit) {
    val c = Aioa.colors
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val scope = rememberCoroutineScope()
    var dev by remember { mutableStateOf<GhDevice?>(null) }
    var note by remember { mutableStateOf<String?>(null) }
    var token by remember { mutableStateOf("") }
    val d = dev
    if (d != null) LaunchedEffect(d.id) {
        while (true) {
            delay(d.interval * SEC)
            val res = api.poll(d.id)
            val r = res.getOrNull()
            if (r == null) note = res.exceptionOrNull()?.message
            if (r == null || r == "pending") continue
            dev = null
            if (r == "done") done() else note = if (r == "denied") "你在 GitHub 上拒绝了授权" else "码已过期, 重新获取"
            break
        }
    }
    SettingsGroup("在电脑上授权", if (device) "在任何登录了 GitHub 的设备上打开地址, 输入下面的码, 手机不用登录 GitHub。" else "服务端没配 GH_CLIENT_ID, 设备码不可用, 先用令牌。") {
        if (d == null) {
            ActionRow("获取授权码", "monitor", enabled = device) { scope.launch { api.startDevice().onSuccess { dev = it; note = null }.onFailure { note = it.message } } }
        } else {
            InfoRow("授权码", d.userCode, c.accent)
            RowDivider()
            ActionRow("复制码", "copy", value = d.verifyUrl.removePrefix("https://")) { clipboard.setText(AnnotatedString(d.userCode)) }
            RowDivider()
            ActionRow("在这台手机上打开", "external-link") { clipboard.setText(AnnotatedString(d.userCode)); Browser.open(context, d.verifyUrl) }
            RowDivider()
            NoteRow("等你在 GitHub 上点 Authorize, 完成后自动刷新, ${time(d.expires)} 前有效。", c.textSecondary)
        }
        note?.let { RowDivider(); NoteRow(it, c.danger) }
    }
    SettingsGroup("粘贴令牌", "fine-grained token, 仓库按需选, 权限给 Issues 读写。不能自动续期。") {
        InputRow("令牌", token, "github_pat_...", secret = true) { token = it.trim() }
        RowDivider()
        ActionRow("去 GitHub 新建令牌", "external-link") { Browser.open(context, PAT_URL) }
    }
    PrimaryAction("保存令牌", enabled = token.length > 20) { scope.launch { api.setToken(token).onSuccess { token = ""; done() }.onFailure { note = it.message } } }
}

/** 快捷规则: 近 N 天有提交, 全部公开, 全部私有; 单个仓库在下面的列表里手动开关。 */
@Composable
private fun RepoRules(r: GhRules, set: (GhRules) -> Unit) {
    SettingsGroup("仓库范围", "GitHub 上授权的仓库是上限, 这里再收窄。手动开关的仓库优先于规则。") {
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Chip("不按时间", r.pushedDays == null) { set(r.copy(pushedDays = null)) }
            QUICK_DAYS.forEach { (d, label) -> Chip(label, r.pushedDays == d) { set(r.copy(pushedDays = d)) } }
        }
        RowDivider(indent = false)
        SwitchRow("全部公开仓库", r.public) { set(r.copy(public = it)) }
        RowDivider()
        SwitchRow("全部私有仓库", r.private) { set(r.copy(private = it)) }
    }
}

@Composable
private fun RepoList(list: List<GhRepo>?, r: GhRules, refresh: () -> Unit, set: (GhRules) -> Unit) {
    val n = list?.count { it.allowed } ?: 0
    SettingsGroup("仓库 (放行 $n / ${list?.size ?: 0})") {
        ActionRow("刷新列表", "refresh-cw") { refresh() }
        list?.forEach { repo ->
            RowDivider()
            val hint = listOfNotNull(if (repo.private) "私有" else "公开", if (repo.pushed > 0) "最近提交 ${date(repo.pushed)}" else null, if (repo.repo in r.repos) "手动放行" else if (repo.repo in r.deny) "手动排除" else null).joinToString(" · ")
            SwitchRow(repo.repo, repo.allowed, hint) { on ->
                set(if (on) r.copy(repos = r.repos + repo.repo, deny = r.deny - repo.repo) else r.copy(repos = r.repos - repo.repo, deny = r.deny + repo.repo))
            }
        }
    }
}
