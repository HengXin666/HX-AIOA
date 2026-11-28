package com.hengxin.aioa.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Icon
import kotlinx.coroutines.delay

private const val SOFT = 0.1f
private const val TICK_MS = 30_000L
private const val MINUTE_MS = 60_000L

/** 剩余有效时间的说明, 没写有效期为 null。 */
fun otpNote(expiresAt: Long?, now: Long): String? = expiresAt?.let {
    val left = it - now
    if (left > 0) "${(left + MINUTE_MS - 1) / MINUTE_MS} 分钟内有效" else "已过期"
}

/** 详情里的关键信息 (#146): 验证码 (大字, 点按复制, 剩余时间, 过期灰显), 金额 / 单号 / 仓库, 登录与确认按钮。 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun MailKeyInfo(m: MailItem, onLink: (String) -> Unit) {
    val c = Aioa.colors
    val context = LocalContext.current
    val d = m.digest
    val exp = d.otp?.expiresAt
    val now by produceState(System.currentTimeMillis(), exp) {
        if (exp == null) return@produceState
        while (value < exp) {
            delay(TICK_MS)
            value = System.currentTimeMillis()
        }
    }
    m.code?.let { code ->
        val expired = exp != null && exp <= now
        val tone = if (expired) c.textSecondary else c.accent
        Row(Modifier.padding(top = 12.dp).clip(RoundedCornerShape(12.dp)).background(tone.copy(alpha = SOFT)).clickable { copyCode(context, code) }.padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("验证码", color = tone, fontSize = 13.sp)
            Spacer(Modifier.width(10.dp))
            Text(code, color = tone, fontSize = 22.sp, fontWeight = FontWeight.Bold, letterSpacing = 2.sp)
            Spacer(Modifier.width(10.dp))
            Icon("copy", tone, 16.dp)
            otpNote(exp, now)?.let { Text(it, Modifier.padding(start = 10.dp), color = c.textSecondary, fontSize = 12.sp) }
        }
    }
    if (d.facts.isEmpty() && d.links.isEmpty()) return
    Column(Modifier.padding(top = 10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (d.facts.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            d.facts.forEach { f -> Tag("${f.label} ${f.value}", c.textSecondary) }
        }
        if (d.links.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            d.links.forEach { l ->
                Text(l.label, Modifier.clip(RoundedCornerShape(16.dp)).background(c.accent.copy(alpha = SOFT)).clickable { onLink(l.url) }.padding(horizontal = 12.dp, vertical = 6.dp), color = c.accent, fontSize = 13.sp, fontWeight = FontWeight.Medium)
            }
        }
    }
}
