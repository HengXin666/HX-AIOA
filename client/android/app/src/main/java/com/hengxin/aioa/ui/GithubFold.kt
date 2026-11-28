package com.hengxin.aioa.ui

import android.content.Context
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Card
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.Text

// GitHub 页与单仓库页的卡片折叠 (#144): 点卡片头收起 / 展开, 折起的卡片 key 存本机, 下次打开照旧
private const val PREFS_FOLD = "github_fold"
private const val KEY_FOLDED = "folded"
private const val TURN_SHUT = -90f

// 各卡片的折叠 key: 全局按卡片种类记, 单仓库页的卡片所有仓库共用一份
const val FOLD_HEAT = "heat"
const val FOLD_TREND = "trend"
const val FOLD_FOOT = "footprint"
const val FOLD_BRANCHES = "branches"
const val FOLD_TODAY = "today"
const val FOLD_REPOS = "repos"
const val FOLD_REPO_HEAD = "repo-head"
const val FOLD_REPO_TREND = "repo-trend"
const val FOLD_REPO_LIST = "repo-list"

/** 折起的 key 集合里切换一个: shut 为 true 加进去, false 拿掉。 */
fun foldToggle(folded: Set<String>, key: String, shut: Boolean): Set<String> = if (shut) folded + key else folded - key

private fun folded(context: Context): Set<String> =
    context.getSharedPreferences(PREFS_FOLD, Context.MODE_PRIVATE).getStringSet(KEY_FOLDED, emptySet()).orEmpty()

private fun saveFold(context: Context, key: String, shut: Boolean) {
    val prefs = context.getSharedPreferences(PREFS_FOLD, Context.MODE_PRIVATE)
    // getStringSet 返回的集合不能原地改, 复制一份再写
    prefs.edit().putStringSet(KEY_FOLDED, HashSet(foldToggle(folded(context), key, shut))).apply()
}

/**
 * 可折叠卡片: 头一行是图标 + 标题 + trailing (收起时隐藏) + 箭头, 点头部切换, 内容展开收起带动画。
 * badge 在收起时显示在标题后, 给一句摘要 (比如 "12 个仓库")。
 */
@Composable
fun FoldCard(
    key: String,
    icon: String,
    title: String,
    badge: String = "",
    trailing: @Composable RowScope.() -> Unit = {},
    content: @Composable ColumnScope.() -> Unit,
) {
    val context = LocalContext.current
    val c = Aioa.colors
    var shut by remember(key) { mutableStateOf(key in folded(context)) }
    val turn by animateFloatAsState(if (shut) TURN_SHUT else 0f, label = "fold")
    Card {
        Row(
            Modifier.fillMaxWidth().clickable(remember { MutableInteractionSource() }, null) {
                shut = !shut
                saveFold(context, key, shut)
            },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(icon, c.textSecondary, 16.dp)
            Box(Modifier.weight(1f)) { Text(title + if (shut && badge.isNotEmpty()) " · $badge" else "", c.text, GH_ROW_SP, weight = FontWeight.Medium) }
            if (!shut) trailing()
            Icon("chevron-down", c.textSecondary, 16.dp, Modifier.rotate(turn))
        }
        AnimatedVisibility(!shut, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) { content() }
        }
    }
}
