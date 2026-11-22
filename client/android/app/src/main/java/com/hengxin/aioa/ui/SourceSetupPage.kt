package com.hengxin.aioa.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.Constants
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Card
import com.hengxin.aioa.kit.Chip
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.Paragraph
import com.hengxin.aioa.kit.Text

private const val STEP_SP = 15
private const val BODY_SP = 14
private const val HINT_SP = 12
private const val COPY = "复制"
private const val GITHUB_WEB = "https://github.com/"
private val REPO = Regex("^[\\w.-]+/[\\w.-]+$")

/** 新建来源后的接入说明。key 与 secret 只在这里出现一次。 */
@Composable
fun SourceResult(state: SourcesState) {
    val setup = state.created ?: return
    val github = setup.source.type == Constants.SOURCE_GITHUB
    SubPage("接入 ${setup.source.name}", { state.back() }, "完成" to { state.back() }) {
        state.error?.let { ErrorCard(it) }
        ConnectCard(state.connected, github)
        OnceCard(setup.secret.isEmpty(), state::recreate, state.busy)
        if (github) GithubSteps(setup) else GenericSteps(setup)
    }
}

@Composable
private fun ConnectCard(connected: String?, github: Boolean) {
    val c = Aioa.colors
    Card {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(if (connected != null) "check" else "refresh-cw", if (connected != null) c.success else c.textSecondary, 16.dp)
            Text(if (connected != null) "已连接 ✓" else "等待第一条事件...", if (connected != null) c.success else c.text, STEP_SP)
        }
        val hint = when {
            connected != null -> "收到: $connected"
            github -> "在 GitHub 保存 Webhook 后会立即发一次 ping, 本页收到后显示已连接。"
            else -> "按下面的说明配置好后, 本页收到该来源的事件就显示已连接。"
        }
        Paragraph(hint, c.textSecondary, HINT_SP)
    }
}

@Composable
private fun OnceCard(noSecret: Boolean, recreate: () -> Unit, busy: Boolean) {
    val c = Aioa.colors
    Card {
        Paragraph("key 和 secret 只显示这一次, 离开本页后无法再查看, 请现在复制保存。", c.warning, BODY_SP)
        Paragraph("丢了也没关系: 服务端暂无重新生成接口, 点下面按钮会删掉这个来源并重建一个同名来源, 旧的 key 随之失效。", c.textSecondary, HINT_SP)
        if (noSecret) Paragraph("服务端没有配置 TOKEN_SECRET, webhookSecret 为空, 无法签名校验。下面的地址已改为带 ?key= 的完整地址。", c.danger, BODY_SP)
        Chip(if (busy) "重建中..." else "删掉重建", false) { if (!busy) recreate() }
    }
}

@Composable
private fun GithubSteps(setup: SourceSetup) {
    val context = LocalContext.current
    val repo = setup.source.subject?.takeIf { REPO.matches(it) }
    val noSecret = setup.secret.isEmpty()
    val payload = if (noSecret) withKey(setup.hookUrl.orEmpty(), setup.key) else setup.hookUrl.orEmpty()
    Step(1, "打开仓库 Settings → Webhooks → Add webhook") {
        if (repo != null) {
            Chip("打开 $repo 的 Webhook 设置", true) { open(context, "$GITHUB_WEB$repo/settings/hooks/new") }
        } else {
            Paragraph("没有填 owner/repo, 请在浏览器打开你的仓库, 进入 Settings → Webhooks → Add webhook。", Aioa.colors.textSecondary, HINT_SP)
            Chip("打开 GitHub", false) { open(context, GITHUB_WEB) }
        }
    }
    Step(2, "Payload URL") { Copyable(payload) }
    Step(3, "Content type 选 application/json") {}
    Step(4, "Secret") {
        if (noSecret) Paragraph("留空。服务端没有配置 TOKEN_SECRET, 改由上面地址里的 key 校验。", Aioa.colors.danger, HINT_SP)
        else Copyable(setup.secret)
    }
    Step(5, "事件选 \"Send me everything\" 或按需勾选") {}
    Step(6, "点 Add webhook 保存") {
        Paragraph("GitHub 会立即发一次 ping, 页面顶部变成 \"已连接 ✓\" 即接入成功。", Aioa.colors.textSecondary, HINT_SP)
    }
}

@Composable
private fun GenericSteps(setup: SourceSetup) {
    val url = setup.hookUrl
    if (url != null) {
        Step(1, "Webhook 地址 (带 key, 大多数系统直接填这个)") { Copyable(withKey(url, setup.key)) }
        Step(2, "不带 key 的地址 (key 放在 Authorization: Bearer 里时用)") { Copyable(url) }
    }
    Step(if (url != null) 3 else 1, "key") { Copyable(setup.key) }
    if (setup.secret.isNotEmpty()) Step(if (url != null) 4 else 2, "webhookSecret (支持 HMAC 签名的系统用)") { Copyable(setup.secret) }
    setup.kind?.setup?.let { text ->
        Card {
            Text("接入说明", Aioa.colors.text, STEP_SP)
            Paragraph(text, Aioa.colors.textSecondary, BODY_SP)
        }
    }
}

@Composable
private fun Step(n: Int, title: String, content: @Composable ColumnScope.() -> Unit) {
    Card {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("$n", Aioa.colors.accent, STEP_SP)
            Paragraph(title, Aioa.colors.text, STEP_SP)
        }
        Column(verticalArrangement = Arrangement.spacedBy(6.dp), content = content)
    }
}

@Composable
private fun Copyable(value: String) {
    val context = LocalContext.current
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.weight(1f)) { Paragraph(value.ifEmpty { "(空)" }, Aioa.colors.text, BODY_SP) }
        Chip(COPY, false) { copy(context, value) }
    }
}

private fun withKey(url: String, key: String): String =
    if (url.isEmpty()) "" else "$url?${Constants.QUERY_KEY}=${Uri.encode(key)}"

private fun copy(context: Context, value: String) {
    context.getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText(COPY, value))
    Toast.makeText(context, "已复制", Toast.LENGTH_SHORT).show()
}

private fun open(context: Context, url: String) {
    runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
        .onFailure { Toast.makeText(context, "没有可以打开链接的应用", Toast.LENGTH_SHORT).show() }
}
