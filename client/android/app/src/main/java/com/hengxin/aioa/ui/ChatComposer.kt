package com.hengxin.aioa.ui

import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.pointerTap
import com.hengxin.aioa.ui.chat.ComposerState
import com.hengxin.aioa.ui.chat.MentionList
import com.hengxin.aioa.ui.chat.MentionOps
import com.hengxin.aioa.ui.chat.MentionTarget
import com.hengxin.aioa.ui.chat.Names
import com.hengxin.aioa.ui.chat.plainPreview
import java.io.File

private val KEY = 40.dp
private val PANEL_H = 220.dp
private const val INPUT_SP = 15
private const val MAX_LINES = 6
private const val PHOTO_DIR = "att"
// 常用表情: 输入法也能输, 这里放一排最常用的, 点了插到光标处
private val EMOJI = "😀 😂 🤣 😊 😍 😘 😎 🤔 😅 😭 😡 😱 👍 👎 👏 🙏 💪 👌 ✌️ 🤝 👀 🎉 🔥 ✅ ❌ ⚠️ 💡 📌 🚀 ❤️ 💯 🙌 😴 🤖 ☕ 🍻 🐛 🛠️ 📦 ⏰".split(" ")

private enum class Panel { NONE, EMOJI, MORE }

/** 会话页输入栏 (#136): 左边语音位, 输入框, 发送; 下一排 表情, 图片, 拍照, 文件, 更多; @ 靠输入 "@" 弹出选择。 */
@Composable
internal fun ChatComposer(g: ChatGroups, state: ComposerState, candidates: List<MentionTarget>, hint: String, more: List<Pair<String, Pair<String, () -> Unit>>>) {
    val c = Aioa.colors
    val context = LocalContext.current
    var panel by rememberSaveable { mutableStateOf(Panel.NONE) }
    val send = {
        if (g.send(state.text, state.tokens())) state.clear()
    }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri -> uri?.let { g.sendFile(it, state.text); state.clear() } }
    var shot by remember { mutableStateOf<Uri?>(null) }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok -> shot?.takeIf { ok }?.let { g.sendFile(it, "") } }
    Column(Modifier.fillMaxWidth().background(c.sidebar)) {
        if (candidates.isNotEmpty()) state.query?.let { q -> MentionList(MentionOps.filter(candidates, q), state::pick) }
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.border.copy(alpha = 0.6f)))
        g.replyTo?.let { r ->
            Row(Modifier.fillMaxWidth().padding(start = 14.dp, end = 8.dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.width(3.dp).height(32.dp).clip(RoundedCornerShape(2.dp)).background(c.accent))
                Column(Modifier.padding(start = 8.dp).weight(1f)) {
                    Text("回复 ${Names.of(r)}", c.text, 12, weight = FontWeight.SemiBold)
                    Text(plainPreview(r.text), c.textSecondary, 12)
                }
                Box(Modifier.size(32.dp).clip(RoundedCornerShape(8.dp)).pointerTap { g.replyTo = null }, contentAlignment = Alignment.Center) { Icon("x", c.textSecondary, 16.dp) }
            }
        }
        Row(Modifier.padding(start = 8.dp, end = 12.dp, top = 10.dp), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Key("mic") { Toast.makeText(context, "语音输入请用输入法", Toast.LENGTH_SHORT).show() }
            Box(Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).background(c.surface).padding(horizontal = 14.dp, vertical = 11.dp)) {
                if (state.text.isEmpty()) Text(hint, c.textSecondary, INPUT_SP)
                BasicTextField(
                    state.value,
                    {
                        if (it.text.length > state.text.length) g.typing()
                        state.value = it
                        if (panel != Panel.NONE) panel = Panel.NONE
                    },
                    Modifier.fillMaxWidth(),
                    textStyle = TextStyle(color = c.text, fontSize = INPUT_SP.sp),
                    cursorBrush = SolidColor(c.accent),
                    maxLines = MAX_LINES,
                )
            }
            val ready = state.text.isNotBlank()
            Text(
                "发送", if (ready) c.onAccent else c.textSecondary, 14,
                Modifier.clip(RoundedCornerShape(12.dp)).background(if (ready) c.accent else c.surface).pointerTap { if (ready) send() }.padding(horizontal = 14.dp, vertical = 10.dp),
                weight = FontWeight.SemiBold,
            )
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 6.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Key("smile", panel == Panel.EMOJI) { panel = if (panel == Panel.EMOJI) Panel.NONE else Panel.EMOJI }
            Key("image") { pick.launch("image/*") }
            Key("camera") {
                val dir = File(context.filesDir, PHOTO_DIR).apply { mkdirs() }
                val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", File(dir, "photo_${System.currentTimeMillis()}.jpg"))
                shot = uri
                runCatching { camera.launch(uri) }.onFailure { Toast.makeText(context, "没有可用的相机", Toast.LENGTH_SHORT).show() }
            }
            Key("folder") { pick.launch("*/*") }
            Key("plus", panel == Panel.MORE) { panel = if (panel == Panel.MORE) Panel.NONE else Panel.MORE }
        }
        when (panel) {
            Panel.EMOJI -> LazyVerticalGrid(GridCells.Fixed(EMOJI_COLS), Modifier.fillMaxWidth().height(PANEL_H).padding(horizontal = 12.dp)) {
                items(EMOJI.size) { i ->
                    Box(Modifier.height(44.dp).clip(RoundedCornerShape(10.dp)).pointerTap { state.insert(EMOJI[i]) }, contentAlignment = Alignment.Center) {
                        androidx.compose.foundation.text.BasicText(EMOJI[i], style = TextStyle(fontSize = EMOJI_SP.sp))
                    }
                }
            }
            Panel.MORE -> Row(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                more.forEach { (icon, p) ->
                    Column(Modifier.clip(RoundedCornerShape(12.dp)).pointerTap { panel = Panel.NONE; p.second() }.padding(6.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Box(Modifier.size(52.dp).clip(RoundedCornerShape(14.dp)).background(c.surface), contentAlignment = Alignment.Center) { Icon(icon, c.text, 22.dp) }
                        Text(p.first, c.textSecondary, 12)
                    }
                }
            }
            Panel.NONE -> Unit
        }
    }
}

private const val EMOJI_COLS = 8
private const val EMOJI_SP = 24

@Composable
private fun Key(icon: String, on: Boolean = false, onClick: () -> Unit) {
    val c = Aioa.colors
    Box(Modifier.size(KEY).clip(RoundedCornerShape(10.dp)).background(if (on) c.surface else c.sidebar).pointerTap(onClick), contentAlignment = Alignment.Center) {
        Icon(icon, if (icon == "mic") c.text else c.textSecondary, 22.dp)
    }
}
