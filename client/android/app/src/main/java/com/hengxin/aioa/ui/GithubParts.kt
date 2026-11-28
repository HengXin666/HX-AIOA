package com.hengxin.aioa.ui

import com.hengxin.aioa.browser.Browser
import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Dot
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.Paragraph
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.pressable

const val ICON_GITHUB = "github"
const val ICON_PR = "git-pull-request"
const val ICON_ISSUE = "circle-dot"
const val ICON_STAR = "star"
const val ICON_RUN = "circle-play"
// 图标库里没有 git-fork, 用分支图标表示 fork
const val ICON_FORK = "git-branch"
const val LABEL_PR = "PR"
const val LABEL_ISSUE = "Issue"
const val LABEL_CI = "CI"
private const val GH_SEP = " · "
const val GITHUB_TITLE = "GitHub"
const val GH_WEB_ROOT = "https://github.com/"
const val GH_META_SP = 12
const val GH_ROW_SP = 15
private const val META_ALPHA = 0.8f
private val META_MAX = 150.dp

/** CI 状态点颜色: 绿成功, 红失败, 黄运行中, 灰其他。 */
@Composable
fun ciColor(status: CiStatus?): Color {
    val c = Aioa.colors
    return when (status) {
        CiStatus.SUCCESS -> c.success
        CiStatus.FAILURE -> c.danger
        CiStatus.RUNNING -> c.warning
        else -> c.textSecondary.copy(alpha = 0.5f)
    }
}

fun ciLabel(status: CiStatus?): String = when (status) {
    CiStatus.SUCCESS -> "成功"
    CiStatus.FAILURE -> "失败"
    CiStatus.RUNNING -> "运行中"
    CiStatus.CANCELLED -> "已取消"
    else -> "未知"
}

/** 动态时间线按 kind 区分图标。 */
fun activityIcon(kind: String): String = when (kind) {
    "push" -> "git-commit-horizontal"
    "pr" -> ICON_PR
    "issue" -> ICON_ISSUE
    "ci" -> ICON_RUN
    "release" -> "tag"
    "star" -> ICON_STAR
    "comment" -> "message-square"
    else -> ICON_GITHUB
}

fun openUrl(context: Context, url: String?) {
    Browser.open(context, url)
}

/** 页面可见期间登记到 GithubState, 收到 github 事件时才刷新。 */
@Composable
fun WatchGithub(state: GithubState, repo: String? = null) {
    DisposableEffect(state, repo) {
        state.attach(repo)
        onDispose { state.detach(repo) }
    }
}

/** CI 一行: 状态点 + workflow + 相对时间。 */
@Composable
fun CiLine(ci: GhCi?) {
    val c = Aioa.colors
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Dot(ciColor(ci?.status))
        val text = if (ci == null) "CI 未知" else metaOf(ci.workflow.ifEmpty { LABEL_CI }, ciLabel(ci.status), ago(ci.at))
        Text(text, c.textSecondary, GH_META_SP)
    }
}

/** 图标 + 数字的小计数。 */
@Composable
fun IconCount(icon: String, count: Int, label: String) {
    val c = Aioa.colors
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Icon(icon, c.textSecondary, 14.dp)
        Text("$count $label", c.textSecondary, GH_META_SP)
    }
}

/** 列表里的一行 (#121 一行一条): 左图标, 标题单行省略, 说明压到右边; 可点开浏览器。 */
@Composable
fun GhRow(icon: String, title: String, meta: String, tint: Color = Aioa.colors.textSecondary, onClick: (() -> Unit)?) {
    val c = Aioa.colors
    Row(
        Modifier.fillMaxWidth().pressable(onClick).padding(vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(icon, tint, 15.dp)
        Text(title, c.text, 14, Modifier.weight(1f))
        if (meta.isNotEmpty()) Text(meta, c.textSecondary.copy(alpha = META_ALPHA), 11, Modifier.widthIn(max = META_MAX))
    }
}

/** 汇总里的一格: 大数字 + 小标签。 */
@Composable
fun SummaryCell(value: Int, label: String, modifier: Modifier = Modifier, color: Color = Aioa.colors.text) {
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text("$value", color, 22, weight = FontWeight.SemiBold)
        Text(label, Aioa.colors.textSecondary, GH_META_SP)
    }
}

fun pushLine(p: GhPush?): String? = p?.let {
    metaOf("${it.by.ifEmpty { "有人" }} 推送到 ${it.branch.ifEmpty { "默认分支" }}", ago(it.at))
}

/** 把非空的几段说明用 " · " 连起来。 */
fun metaOf(vararg parts: String): String = parts.filter { it.isNotEmpty() }.joinToString(GH_SEP)

/** 仓库来源标识 (#144): fork 写上游 ("fork 自 a/b"), 不知道上游只写 "fork", 自建写 "自建"。 */
fun repoOrigin(fork: Boolean, parent: String?): String = when {
    !fork -> "自建"
    parent.isNullOrEmpty() -> "fork"
    else -> "fork 自 $parent"
}
