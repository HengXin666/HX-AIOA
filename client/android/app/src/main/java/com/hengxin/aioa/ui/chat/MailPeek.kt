package com.hengxin.aioa.ui.chat

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.hengxin.aioa.proto.Envelope
import org.json.JSONObject

/** 总览里的一条是邮件群的信时, 拼回邮件列表接口的形状解析成一封信; 不是信返回 null。 */
fun Envelope.mailItem(api: MailApi): MailItem? {
    val m = mail ?: return null
    val data = JSONObject().put("title", title).put("summary", summary.orEmpty()).put("mail", JSONObject(m))
    return api.item(JSONObject().put("id", id).put("seq", seq).put("ts", ts).put("data", data))
}

/** 总览用: 一份邮件状态 (接口, 共用的已读记录)。 */
@Composable
fun rememberMailState(): MailState {
    val context = LocalContext.current
    return remember { MailState(MailApi(context.applicationContext), MailSeen.of(context)) }
}

/**
 * 单独打开一封信: 和邮件群里点开的是同一个详情页 (原文渲染, 翻译, 转发, 交给 Agent),
 * 但不进群, 不加载前后的信, 也就不会把群里别的消息标成已读; 只把这一封记为已读。返回键关掉, 回到打开它的地方。
 */
@Composable
fun MailPeek(item: MailItem, s: MailState, onClose: () -> Unit) {
    val thread = remember(item.id) { MailThread(threadKey(item), listOf(item)) }
    LaunchedEffect(item.id) {
        s.seen.set(listOf(item), true)
        // 翻译开关, 静音站点, 转发规则
        s.loadPrefs()
    }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Box(Modifier.fillMaxSize().systemBarsPadding()) { MailDetail(thread, s, onClose) }
    }
}
