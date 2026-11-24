package com.hengxin.aioa.ui.chat

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Icon

/** 切换收件账号: 只列真实收件地址, 认不出的旧信归 "未知收件人"。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccountSheet(s: MailState, close: () -> Unit) {
    val c = Aioa.colors
    ModalBottomSheet(close, containerColor = c.surface) {
        Column(Modifier.navigationBarsPadding().padding(bottom = 12.dp)) {
            Text("收件账号", Modifier.padding(horizontal = 20.dp, vertical = 6.dp), color = c.textSecondary, fontSize = 13.sp)
            AccountRow("inbox", "全部收件箱", "所有账号", s.total, s.account == null) { s.account = null; close() }
            s.facets.accounts.forEach { f ->
                val unknown = f.key.isEmpty()
                AccountRow(if (unknown) "ban" else "at-sign", accountLabel(f.key), if (unknown) "旧信没存投递地址, 无法还原" else "最近 ${mailTime(LocalContext.current, f.last)}", f.count, s.account == f.key) { s.account = f.key; close() }
            }
        }
    }
}

@Composable
private fun AccountRow(icon: String, title: String, hint: String, count: Int, on: Boolean, onClick: () -> Unit) {
    val c = Aioa.colors
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 20.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(36.dp).clip(CircleShape).background(if (on) c.accent else c.surfaceAlt), contentAlignment = Alignment.Center) {
            Icon(icon, if (on) c.onAccent else c.textSecondary, 18.dp)
        }
        Column(Modifier.padding(start = 12.dp).weight(1f)) {
            Text(title, color = if (on) c.accent else c.text, fontSize = 15.sp, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(hint, color = c.textSecondary, fontSize = 12.sp, maxLines = 1)
        }
        Text("$count", color = c.textSecondary, fontSize = 13.sp)
        if (on) Icon("check", c.accent, 18.dp, Modifier.padding(start = 8.dp))
    }
}

/** 按厂商: 每家一行, 带网站图标。 */
@Composable
fun VendorList(list: List<MailFacet>, pick: (String) -> Unit) {
    val c = Aioa.colors
    val context = LocalContext.current
    LazyColumn(Modifier.fillMaxWidth(), contentPadding = PaddingValues(bottom = 24.dp)) {
        items(list, key = { it.key }) { f ->
            Row(Modifier.fillMaxWidth().background(c.surface).clickable { pick(f.key) }.padding(horizontal = MAIL_PAD.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                MailAvatar(f.from ?: f.key, f.key, 40.dp)
                Column(Modifier.padding(start = 12.dp).weight(1f)) {
                    Text(f.key, color = c.text, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("${f.count} 封 · 最近 ${mailTime(context, f.last)}", color = c.textSecondary, fontSize = 12.sp)
                }
                Icon("chevron-right", c.textSecondary, 18.dp)
            }
        }
    }
}

fun copyCode(context: Context, code: String) {
    val cm = context.getSystemService(ClipboardManager::class.java) ?: return
    cm.setPrimaryClip(ClipData.newPlainText("验证码", code))
    Toast.makeText(context, "已复制 $code", Toast.LENGTH_SHORT).show()
}
