package com.hengxin.aioa.ui.chat

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.text.format.DateUtils
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.InputChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

private enum class MailTab(val label: String) { LATEST("最新"), VENDOR("按厂商"), ACCOUNT("按账号") }

private const val PREFETCH = 8
private const val AVATAR = 36
private const val PAD = 12

/** 邮件群的状态: 当前分段, 筛选, 已加载的列表与统计。离开再回来不重拉。 */
private class MailState(private val api: MailApi) {
    var tab by mutableStateOf(MailTab.LATEST)
    var vendor by mutableStateOf<String?>(null)
    var account by mutableStateOf<String?>(null)
    val items = mutableStateListOf<MailItem>()
    var more by mutableStateOf(false)
    var loading by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
    var vendors by mutableStateOf<List<MailFacet>>(emptyList())
    var accounts by mutableStateOf<List<MailFacet>>(emptyList())
    var open by mutableStateOf<Long?>(null)

    val filtered get() = vendor != null || account != null
    val showList get() = tab == MailTab.LATEST || filtered

    suspend fun reload() {
        loading = true
        api.list(vendor, account, null).onSuccess { items.clear(); items.addAll(it.items); more = it.more; error = null }.onFailure { error = it.message }
        api.facets().onSuccess { vendors = it.first; accounts = it.second }
        loading = false
    }

    suspend fun older() {
        if (loading || !more) return
        loading = true
        api.list(vendor, account, items.lastOrNull()?.ts).onSuccess { p -> items.addAll(p.items.filter { n -> items.none { it.seq == n.seq } }); more = p.more }.onFailure { error = it.message }
        loading = false
    }
}

/** 邮件视图: 最新 / 按厂商 / 按账号, 点分组进筛选列表, 点信展开, 验证码点一下复制。 */
@Composable
fun MailView(head: Long?, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val s = remember { MailState(MailApi(context.applicationContext)) }
    val scope = rememberCoroutineScope()
    // 群里来了新信 (head 变了) 就刷新第一页
    LaunchedEffect(head, s.vendor, s.account) { s.reload() }
    if (s.filtered) BackHandler { s.vendor = null; s.account = null }
    Column(modifier) {
        Row(Modifier.fillMaxWidth().padding(horizontal = PAD.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            MailTab.values().forEach { t -> FilterChip(s.tab == t, { s.tab = t; s.vendor = null; s.account = null }, { Text(t.label) }) }
        }
        val filter = s.vendor ?: s.account
        if (filter != null) {
            InputChip(true, { s.vendor = null; s.account = null }, { Text("$filter  ×", maxLines = 1, overflow = TextOverflow.Ellipsis) }, Modifier.padding(horizontal = PAD.dp))
        }
        s.error?.let { Text(it, Modifier.padding(horizontal = PAD.dp), fontSize = 12.sp, color = MaterialTheme.colorScheme.error) }
        when {
            s.showList -> MailList(s, context) { scope.launch { s.older() } }
            s.tab == MailTab.VENDOR -> FacetList(s.vendors) { s.vendor = it }
            else -> FacetList(s.accounts) { s.account = it }
        }
    }
}

@Composable
private fun MailList(s: MailState, context: Context, loadMore: () -> Unit) {
    val state = rememberLazyListState()
    val nearEnd by remember { derivedStateOf { (state.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) >= state.layoutInfo.totalItemsCount - PREFETCH } }
    LaunchedEffect(nearEnd, s.items.size) { if (nearEnd) loadMore() }
    if (s.items.isEmpty() && !s.loading) {
        Text("还没有邮件。把信转发到邮件路由地址, 或在 HX-Email 里配置 Webhook。", Modifier.padding(PAD.dp), fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        return
    }
    LazyColumn(Modifier.fillMaxWidth(), state, contentPadding = PaddingValues(bottom = 16.dp)) {
        items(s.items, key = { it.seq }) { m ->
            MailRow(m, s.open == m.seq, context) { s.open = if (s.open == m.seq) null else m.seq }
            HorizontalDivider(Modifier.padding(start = (PAD * 2 + AVATAR).dp))
        }
    }
}

@Composable
private fun MailRow(m: MailItem, expanded: Boolean, context: Context, toggle: () -> Unit) {
    var full by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().clickable(onClick = toggle).padding(horizontal = PAD.dp, vertical = 10.dp)) {
        Box(Modifier.size(AVATAR.dp).background(MaterialTheme.colorScheme.secondaryContainer, CircleShape), contentAlignment = Alignment.Center) {
            Text(m.vendor.take(1).uppercase(), fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSecondaryContainer)
        }
        Column(Modifier.padding(start = PAD.dp).weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(m.name ?: m.vendor, Modifier.weight(1f), fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(timeOf(context, m.ts), fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text(m.subject, fontSize = 15.sp, fontWeight = FontWeight.Medium, maxLines = if (expanded) Int.MAX_VALUE else 1, overflow = TextOverflow.Ellipsis)
            m.code?.let { code ->
                Text(
                    code,
                    Modifier.padding(top = 4.dp).background(MaterialTheme.colorScheme.primaryContainer, RoundedCornerShape(6.dp)).clickable { copy(context, code) }.padding(horizontal = 8.dp, vertical = 2.dp),
                    fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onPrimaryContainer,
                )
            }
            if (!expanded) {
                if (m.summary.isNotEmpty()) Text(m.summary, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                return@Column
            }
            Text("${m.from} → ${m.account}", Modifier.padding(top = 4.dp), fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            SelectionContainer { Text(m.summary, Modifier.padding(top = 6.dp), fontSize = 13.sp) }
            if (m.html != null) TextButton({ full = true }) { Text("查看原文") }
        }
    }
    if (full && m.html != null) HtmlViewer(m.html, m.subject) { full = false }
}

@Composable
private fun FacetList(list: List<MailFacet>, pick: (String) -> Unit) {
    val context = LocalContext.current
    LazyColumn(Modifier.fillMaxWidth()) {
        items(list, key = { it.key }) { f ->
            Row(Modifier.fillMaxWidth().clickable { pick(f.key) }.padding(horizontal = PAD.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(f.key, Modifier.weight(1f), fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("${f.count} 封 · ${timeOf(context, f.last)}", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            HorizontalDivider()
        }
    }
}

private fun timeOf(context: Context, ts: Long): String =
    if (DateUtils.isToday(ts)) DateUtils.formatDateTime(context, ts, DateUtils.FORMAT_SHOW_TIME)
    else DateUtils.formatDateTime(context, ts, DateUtils.FORMAT_SHOW_DATE or DateUtils.FORMAT_ABBREV_MONTH)

private fun copy(context: Context, code: String) {
    val cm = context.getSystemService(ClipboardManager::class.java) ?: return
    cm.setPrimaryClip(ClipData.newPlainText("验证码", code))
    Toast.makeText(context, "已复制 $code", Toast.LENGTH_SHORT).show()
}
