package com.hengxin.aioa.ui.chat

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Icon
import kotlinx.coroutines.launch

private const val PAD = 20

/** 邮件设置: 远程图片默认策略, 按发件人记住的选择, 自动转发规则。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MailPrefsSheet(s: MailState, close: () -> Unit) {
    val c = Aioa.colors
    val scope = rememberCoroutineScope()
    val p = s.prefs
    ModalBottomSheet(close, containerColor = c.surface) {
        Column(Modifier.navigationBarsPadding().heightIn(max = 680.dp).verticalScroll(rememberScrollState()).padding(bottom = 16.dp)) {
            Head("远程图片")
            Text("白名单是分类表里认识的厂商 (${p.known.size} 个域名); 其余按下面每个发件人的设置, 没设置的按默认。", Modifier.padding(horizontal = PAD.dp), color = c.textSecondary, fontSize = 12.sp, lineHeight = 18.sp)
            IMAGE_POLICY_LABEL.forEach { (k, label) ->
                SheetRow(if (k == IMAGES_NONE) "eye-off" else "eye", label, checked = p.images == k) { scope.launch { s.savePrefs(p.copy(images = k)) } }
            }
            Head("发件人设置 (${p.senders.size})")
            if (p.senders.isEmpty()) Empty("在邮件详情里点 \"总是显示\" 或切换样式会记在这里")
            p.senders.toSortedMap().forEach { (k, v) ->
                val desc = listOfNotNull(v.images?.let { if (it == SHOW) "显示图片" else "拦截图片" }, v.style?.let { STYLE_LABEL[it] }).joinToString(" · ")
                Line(k, desc) { scope.launch { s.savePrefs(p.withSender(k, MailSenderPref())) } }
            }
            Head("自动转发 (${s.rules.size})")
            if (s.rules.isEmpty()) Empty("在邮件详情里 \"转进群\" / \"交给 Agent\" 时打开 \"以后自动转\" 即可添加")
            s.rules.forEach { r ->
                Row(Modifier.fillMaxWidth().padding(horizontal = PAD.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(r.label(), color = c.text, fontSize = 14.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Text("转到 ${r.channel}" + if (r.keep) "" else " · 转完从列表删掉", color = c.textSecondary, fontSize = 12.sp)
                    }
                    Switch(r.on, { on -> scope.launch { s.saveRules(s.rules.map { if (it.id == r.id) it.copy(on = on) else it }) } })
                    Icon("trash-2", c.textSecondary, 18.dp, Modifier.padding(start = 10.dp).clip(RoundedCornerShape(8.dp)).clickable { scope.launch { s.saveRules(s.rules.filter { it.id != r.id }) } })
                }
            }
        }
    }
}

@Composable
private fun Head(t: String) {
    Text(t, Modifier.padding(start = PAD.dp, top = 14.dp, bottom = 4.dp), color = Aioa.colors.text, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
}

@Composable
private fun Empty(t: String) {
    Text(t, Modifier.padding(horizontal = PAD.dp, vertical = 6.dp), color = Aioa.colors.textSecondary, fontSize = 12.sp)
}

@Composable
private fun Line(k: String, v: String, remove: () -> Unit) {
    val c = Aioa.colors
    Row(Modifier.fillMaxWidth().padding(horizontal = PAD.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(k, color = c.text, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(v, color = c.textSecondary, fontSize = 12.sp)
        }
        Icon("trash-2", c.textSecondary, 18.dp, Modifier.clip(RoundedCornerShape(8.dp)).clickable(onClick = remove))
    }
}
