package com.hengxin.aioa.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Icon
import com.hengxin.aioa.kit.Icons
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.kit.pointerTap
import kotlinx.coroutines.launch

// 换空间图标 (#142): 从组件库图标集里选 (按英文名或中文关键词搜), 或上传 PNG / JPEG / WebP / SVG ([SpaceIconImport])。
// 选中立即生效: 插件空间存 state.icon, 内置页面存账号设置 homeTabs.icons, 顶部标签, 侧栏, 标题切换都跟着变。

// 常用图标的中文关键词, 搜中文时用; 没列的只能按英文名搜
private val ZH = mapOf(
    "activity" to "活动 动态 心跳", "alarm-clock" to "闹钟 提醒", "archive" to "归档", "bell" to "通知 铃", "bot" to "机器人 agent 智能体",
    "calendar-days" to "日历 日程", "check" to "完成 勾", "code-xml" to "代码 开发", "cpu" to "处理器 性能", "file-text" to "文档 文件",
    "flame" to "火 热门", "folder" to "文件夹 目录", "gauge" to "仪表 总览", "github" to "代码 仓库", "git-branch" to "分支", "globe" to "网络 地球 网站",
    "hard-drive" to "硬盘 存储", "inbox" to "收件箱", "key-round" to "钥匙 密码", "layers" to "图层 空间", "layout-dashboard" to "看板 面板 总览",
    "lightbulb" to "灯泡 点子 想法", "list-checks" to "清单 待办", "mail" to "邮件", "megaphone" to "公告 喇叭", "message-circle" to "消息 聊天",
    "monitor" to "显示器 电脑", "moon" to "月亮 夜", "palette" to "调色板 主题 颜色", "plug" to "插件 插头", "puzzle" to "插件 拼图", "server" to "服务器 主机",
    "settings" to "设置", "shield-check" to "安全 盾", "sparkles" to "闪光 ai", "star" to "收藏 星", "sun" to "太阳 白天", "terminal" to "终端 命令",
    "thermometer" to "温度", "user" to "用户 我", "users" to "成员 用户", "camera" to "相机 照片", "image" to "图片", "mic" to "麦克风 语音",
)

/** 按关键词过滤图标名: 空串全部; 英文名包含, 或中文关键词包含。 */
internal fun searchIcons(names: Collection<String>, query: String): List<String> {
    val q = query.trim().lowercase()
    if (q.isEmpty()) return names.toList()
    return names.filter { it.contains(q) || ZH[it]?.contains(q) == true }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SpaceIconSheet(title: String, current: String, changed: Boolean, onPick: (String?) -> Unit, close: () -> Unit) {
    val c = Aioa.colors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var query by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf<String?>(null) }
    val upload = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        busy = true
        err = null
        scope.launch {
            SpaceIconImport.import(context.applicationContext, uri).onSuccess { onPick(it); close() }.onFailure { err = it.message ?: "上传失败" }
            busy = false
        }
    }
    val names = remember(query) { searchIcons(Icons.names, query) }
    ModalBottomSheet(close, containerColor = c.popover) {
        Column(Modifier.navigationBarsPadding().padding(horizontal = 14.dp).padding(bottom = 18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(Modifier.size(44.dp).clip(RoundedCornerShape(10.dp)).background(c.surfaceAlt), contentAlignment = Alignment.Center) { Icon(current, c.text, 22.dp) }
                Column(Modifier.weight(1f)) {
                    Text("换图标", c.text, 16, weight = FontWeight.SemiBold)
                    Text(title, c.textSecondary, 12)
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Action(if (busy) "上传中..." else "上传图片", "image", enabled = !busy) { upload.launch(SpaceIconImport.MIMES) }
                if (changed) Action("恢复默认", "undo-2", enabled = !busy) { onPick(null); close() }
            }
            Text("可传 ${SpaceIconImport.MIMES_HINT}, 会缩成 96px 的 PNG; 只用单色或 currentColor 的 SVG 跟主题变色", c.textSecondary, 12, maxLines = 2)
            err?.let { Text(it, c.danger, 12) }
            OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth(), singleLine = true, placeholder = { androidx.compose.material3.Text("搜图标, 如 server, 服务器") })
            if (names.isEmpty()) Text("没有匹配的图标", c.textSecondary, 13, Modifier.padding(4.dp))
            LazyVerticalGrid(GridCells.Adaptive(52.dp), Modifier.fillMaxWidth().heightIn(max = 360.dp), verticalArrangement = Arrangement.spacedBy(6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                items(names, key = { it }) { n ->
                    val on = n == current
                    Box(
                        Modifier.size(52.dp).clip(RoundedCornerShape(10.dp)).background(if (on) c.surfaceAlt else c.surface)
                            .then(if (on) Modifier.border(1.5.dp, c.accent, RoundedCornerShape(10.dp)) else Modifier)
                            .pointerTap { onPick(n); close() },
                        contentAlignment = Alignment.Center,
                    ) { Icon(n, if (on) c.accent else c.text, 22.dp) }
                }
            }
        }
    }
}

@Composable
private fun Action(label: String, icon: String, enabled: Boolean, onClick: () -> Unit) {
    val c = Aioa.colors
    Row(
        Modifier.clip(RoundedCornerShape(10.dp)).background(c.surface).then(if (enabled) Modifier.pointerTap(onClick) else Modifier).padding(horizontal = 12.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(icon, if (enabled) c.accent else c.textSecondary, 16.dp)
        Text(label, if (enabled) c.accent else c.textSecondary, 13)
    }
}
