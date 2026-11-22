package com.hengxin.aioa.ui.term

import android.annotation.SuppressLint
import android.content.ClipboardManager
import android.util.Base64
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import org.json.JSONObject
import java.util.UUID

private const val PAGE = "file:///android_asset/term/index.html"
private const val BRIDGE = "Bridge"
private const val ESC = "\u001b"
private val BG = Color(0xFF0D1117)
private val KEY_BG = Color(0xFF21262D)
private val KEY_ON = Color(0xFF1F6FEB)
private val FG = Color(0xFFC9D1D9)
private val DIM = Color(0xFF8B949E)

/** 快捷键栏: 软键盘上没有或不好按的键。 */
private val KEYS = listOf(
    "Esc" to ESC, "Tab" to "\t", "↑" to "$ESC[A", "↓" to "$ESC[B", "←" to "$ESC[D", "→" to "$ESC[C",
    "|" to "|", "~" to "~", "/" to "/", "-" to "-", "Home" to "$ESC[H", "End" to "$ESC[F",
)

private enum class Phase { CONNECTING, READY, CLOSED }

private fun b64(text: String) = Base64.encodeToString(text.toByteArray(), Base64.NO_WRAP)

/** 全屏终端: xterm.js (本地资源) 跑在 WebView 里, 字节经 App 的长连接转给探针。关掉窗口即结束会话。 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun TerminalDialog(hub: TermHub, subject: String, ticket: String, onClose: () -> Unit) {
    val context = LocalContext.current
    val sid = remember { UUID.randomUUID().toString() }
    var phase by remember { mutableStateOf(Phase.CONNECTING) }
    var note by remember { mutableStateOf("连接中...") }
    var ctrl by remember { mutableStateOf(false) }
    val web = remember {
        WebView(context).apply {
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            setBackgroundColor(android.graphics.Color.parseColor("#0D1117"))
            settings.javaScriptEnabled = true
            // 只加载本地页面, 不允许访问文件与网络内容
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.blockNetworkLoads = true
        }
    }
    fun js(code: String) = web.post { web.evaluateJavascript(code, null) }
    val sink = remember {
        object : TermSink {
            override fun ready() {
                phase = Phase.READY
                note = ""
                js("focusTerm()")
            }
            override fun data(b64: String) {
                js("w('$b64')")
            }
            override fun closed(reason: String?) {
                phase = Phase.CLOSED
                note = reason ?: "会话已结束"
                js("sys(${JSONObject.quote("[$note]")})")
            }
        }
    }
    val bridge = remember {
        object {
            @JavascriptInterface
            fun ready(cols: Int, rows: Int) {
                web.post { if (!hub.open(sid, subject, ticket, cols, rows, sink)) sink.closed("未连接到服务端") }
            }
            @JavascriptInterface
            fun input(data: String) = web.post { hub.input(sid, data) }
            @JavascriptInterface
            fun resize(cols: Int, rows: Int) = web.post { hub.resize(sid, cols, rows) }
            @JavascriptInterface
            fun ctrlUsed() = web.post { ctrl = false }
        }
    }
    DisposableEffect(Unit) {
        web.addJavascriptInterface(bridge, BRIDGE)
        web.loadUrl(PAGE)
        onDispose {
            hub.close(sid)
            web.removeJavascriptInterface(BRIDGE)
            web.destroy()
        }
    }
    val close = {
        hub.close(sid)
        onClose()
    }
    Dialog(onDismissRequest = close, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        BackHandler(onBack = close)
        Column(Modifier.fillMaxSize().background(BG).systemBarsPadding().imePadding()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(subject, color = FG, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                Text(if (phase == Phase.READY) "已连接" else note, color = DIM, fontSize = 12.sp, maxLines = 1)
                Text("关闭", color = KEY_ON, fontSize = 14.sp, modifier = Modifier.padding(start = 14.dp).clickable(onClick = close))
            }
            Box(Modifier.weight(1f).fillMaxWidth()) { AndroidView({ web }, Modifier.fillMaxSize()) }
            Row(
                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(6.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Key("Ctrl", on = ctrl) {
                    ctrl = !ctrl
                    js("setCtrl($ctrl)")
                }
                KEYS.forEach { (label, seq) -> Key(label) { hub.input(sid, b64(seq)) } }
                Key("粘贴") {
                    val clip = context.getSystemService(ClipboardManager::class.java)?.primaryClip
                    val text = clip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(context)?.toString()
                    if (!text.isNullOrEmpty()) hub.input(sid, b64(text))
                }
            }
        }
    }
}

@Composable
private fun Key(label: String, on: Boolean = false, onClick: () -> Unit) {
    Box(
        Modifier.clip(RoundedCornerShape(6.dp)).background(if (on) KEY_ON else KEY_BG).clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 8.dp),
    ) { Text(label, color = FG, fontSize = 13.sp, fontFamily = FontFamily.Monospace) }
}
