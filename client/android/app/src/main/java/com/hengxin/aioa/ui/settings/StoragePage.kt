package com.hengxin.aioa.ui.settings

import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.config.TgBots
import com.hengxin.aioa.kit.ProgressLine
import com.hengxin.aioa.ui.OneRow
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.Chip
import com.hengxin.aioa.kit.Text
import com.hengxin.aioa.net.Api
import com.hengxin.aioa.ui.chat.FileTransfer
import com.hengxin.aioa.ui.drive.DRIVE_SCOPE_HINT
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

private const val FILES_API = "api/v1/files"
private const val SETTINGS_API = "api/v1/settings"
private const val KEY_STORAGE = "storage"
private const val STORE_R2 = "r2"
private const val STORE_CFD = "cfd"
private const val OFF = "off"
private const val LABEL_SP = 14
private const val MB = 1024L * 1024
private val THRESHOLDS = listOf(5L, 10L, 20L, 50L, 95L)
private const val THRESHOLD_MAX_MB = 95L
private const val MODE_ALL_CFD = "all-cfd"
private const val MODE_SPLIT = "split"
private const val MODE_ALL_R2 = "all-r2"
private val STORE_LABELS = listOf(STORE_R2 to "R2", STORE_CFD to "Drive")
private const val MIGRATE_API = "api/v1/files/migrate"
private const val MIGRATE_POLL_MS = 3000L
private val COLD_DAYS = listOf(0, 30, 90, 180)

/**
 * 存储: 主人看各后端用量并改存储路由 (只影响之后上传的文件, 已有文件留在原后端);
 * 所有人都能看和清理本机的附件缓存。头像等不走文件后端, 不在这里。
 */
@Composable
fun StoragePage(owner: Boolean, onBack: (() -> Unit)?) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var reload by remember { mutableIntStateOf(0) }
    var cache by remember { mutableLongStateOf(-1L) }
    var error by remember { mutableStateOf("") }
    var clearing by remember { mutableStateOf(false) }
    LaunchedEffect(reload) { cache = withContext(Dispatchers.IO) { FileTransfer.cacheBytes(context) } }
    SettingsPageFrame(SettingsPage.STORAGE.title, onBack) {
        if (owner) {
            val usage = rememberCached("files:usage", FILES_API, reload = reload)
            val body = usage.body
            if (body == null) {
                SettingsGroup { NoteRow(usage.error.ifEmpty { "加载中..." }) }
            } else {
                UsageGroup(body)
                RouteGroup(body) { patch ->
                    scope.launch {
                        error = withContext(Dispatchers.IO) { saveRoute(context, patch) }
                        reload++
                    }
                }
                val ready = body.optJSONObject("ready")
                if (ready?.optBoolean(STORE_CFD) == true) {
                    DirectGroup(body.optJSONObject(KEY_STORAGE)?.optBoolean("direct") == true) { patch ->
                        scope.launch {
                            error = withContext(Dispatchers.IO) { saveRoute(context, patch) }
                            reload++
                        }
                    }
                }
                if (ready?.optBoolean(STORE_R2) == true && ready.optBoolean(STORE_CFD)) {
                    MigrateGroup(body.optJSONObject(KEY_STORAGE)?.optInt("coldDays") ?: 0, { reload++ }) { patch ->
                        scope.launch {
                            error = withContext(Dispatchers.IO) { saveRoute(context, patch) }
                            reload++
                        }
                    }
                }
            }
            if (error.isNotEmpty()) SettingsGroup { NoteRow(error, Aioa.colors.danger) }
        }
        SettingsGroup("本机", "下载过的附件存在本机, 同一个文件只下一次; 清理后再打开会重新下载。") {
            InfoRow("附件缓存", if (cache < 0) "计算中..." else FileTransfer.sizeText(cache))
            RowDivider(false)
            ActionRow("清理附件缓存", "trash-2", danger = true, enabled = cache > 0) { clearing = true }
        }
    }
    if (clearing) {
        AlertDialog(
            onDismissRequest = { clearing = false },
            title = { androidx.compose.material3.Text("清理附件缓存?") },
            text = { androidx.compose.material3.Text("只删本机副本, 服务端的文件和消息不受影响。") },
            confirmButton = {
                TextButton({
                    clearing = false
                    scope.launch {
                        withContext(Dispatchers.IO) { FileTransfer.clearCache(context) }
                        reload++
                    }
                }) { androidx.compose.material3.Text("清理", color = Aioa.colors.danger) }
            },
            dismissButton = { TextButton({ clearing = false }) { androidx.compose.material3.Text("取消") } },
        )
    }
}

@Composable
private fun UsageGroup(body: JSONObject) {
    val by = body.optJSONObject("byStore")
    val ready = body.optJSONObject("ready")
    val r2 = by?.optJSONObject(STORE_R2)
    val cfd = by?.optJSONObject(STORE_CFD)
    val limit = body.optLong("limit")
    // 一行一条 (#138): 图标, 名字, 用量压到右边, R2 带小进度条; 接了 Drive 时写清网盘看哪里 (#157)
    SettingsGroup("用量", footer = DRIVE_SCOPE_HINT.takeIf { ready?.optBoolean(STORE_CFD) == true }) {
        val r2Bytes = r2?.optLong("bytes") ?: 0
        val r2On = ready?.optBoolean(STORE_R2) == true
        OneRow("archive", "R2", if (r2On) "${FileTransfer.sizeText(r2Bytes)} / ${FileTransfer.sizeText(limit)} · ${r2?.optInt("count") ?: 0} 个" else "未绑定", pad = 16) {
            if (r2On && limit > 0) ProgressLine(r2Bytes.toFloat() / limit, Modifier.width(USAGE_BAR))
        }
        RowDivider(false)
        val cfdOn = ready?.optBoolean(STORE_CFD) == true
        OneRow("hard-drive", "Drive (TG)", if (cfdOn) "${FileTransfer.sizeText(cfd?.optLong("bytes") ?: 0)} · ${cfd?.optInt("count") ?: 0} 个" else "未接入", pad = 16)
    }
}

private val USAGE_BAR = 48.dp

/**
 * 路由: 先选方式 (全部走 Drive / 按大小分 / 全部 R2), 按大小分时再定分界, 预设之外可以自己填。
 * 没绑定的后端不出现在选项里, 由服务端最终校验; 老配置对不上三种方式时显示原来的逐项选择, 方便改回来。
 */
@Composable
private fun RouteGroup(body: JSONObject, save: (JSONObject) -> Unit) {
    val s = body.optJSONObject(KEY_STORAGE) ?: JSONObject()
    val ready = body.optJSONObject("ready")
    val can = { k: String -> ready?.optBoolean(k) == true }
    val threshold = s.optLong("threshold") / MB
    val mode = modeOf(s.optString("small"), s.optString("large"))
    var custom by remember { mutableStateOf("") }
    val customMb = custom.toLongOrNull()?.takeIf { it in 1..THRESHOLD_MAX_MB }
    val modes = buildList {
        if (can(STORE_CFD)) add(MODE_ALL_CFD to "全部走 Drive")
        if (can(STORE_CFD) && can(STORE_R2)) add(MODE_SPLIT to "按大小分")
        if (can(STORE_R2)) add(MODE_ALL_R2 to "全部 R2")
    }
    SettingsGroup("存储路由", "只影响之后上传的文件; 已有文件留在原后端, 已发的消息照常能下载。") {
        OptionRow("方式", modes, mode) { save(routeOf(it)) }
        RowDivider(false)
        when (mode) {
            MODE_ALL_CFD -> NoteRow("所有文件都存到 TG, 不占 R2, 单个文件不限大小 (超过 95 MB 自动分片)。小文件上传比 R2 慢 2 到 3 秒, 邮件附件与正文也只有 TG 一份。")
            MODE_ALL_R2 -> NoteRow("单个文件最大 95 MB, 更大的拒收; R2 总量 8 GB。")
            MODE_SPLIT -> {
                OptionRow("超过多少走 Drive (现在 $threshold MB)", THRESHOLDS.map { "${it * MB}" to "$it MB" }, "${s.optLong("threshold")}") {
                    save(JSONObject().put("threshold", it.toLong()))
                }
                RowDivider(false)
                InputRow("自定义分界 (MB)", custom, "1 到 $THRESHOLD_MAX_MB 的整数") { v -> custom = v.filter { it.isDigit() }.take(2) }
                RowDivider(false)
                ActionRow("保存分界", "check", enabled = customMb != null) {
                    save(JSONObject().put("threshold", (customMb ?: return@ActionRow) * MB))
                    custom = ""
                }
            }
            else -> {
                OptionRow("$threshold MB 以内", STORE_LABELS.filter { can(it.first) }, s.optString("small")) { save(JSONObject().put("small", it)) }
                RowDivider(false)
                OptionRow("超过 $threshold MB", STORE_LABELS.filter { can(it.first) } + (OFF to "不收"), s.optString("large")) { save(JSONObject().put("large", it)) }
            }
        }
        if (can(STORE_CFD) && mode != MODE_ALL_CFD) {
            RowDivider(false)
            SwitchRow("R2 满了改走 Drive", s.optString("onFull") == STORE_CFD, "关闭时 R2 满了拒收新文件") {
                save(JSONObject().put("onFull", if (it) STORE_CFD else "reject"))
            }
        }
    }
}

/** 现有配置对应哪种方式; 对不上 (例如小文件走 Drive, 大文件走 R2) 返回空串。 */
private fun modeOf(small: String, large: String): String = when {
    small == STORE_CFD && large == STORE_CFD -> MODE_ALL_CFD
    small == STORE_R2 && large == STORE_CFD -> MODE_SPLIT
    small == STORE_R2 && large == STORE_R2 -> MODE_ALL_R2
    else -> ""
}

private fun routeOf(mode: String): JSONObject = when (mode) {
    MODE_ALL_CFD -> JSONObject().put("small", STORE_CFD).put("large", STORE_CFD)
    MODE_SPLIT -> JSONObject().put("small", STORE_R2).put("large", STORE_CFD)
    else -> JSONObject().put("small", STORE_R2).put("large", STORE_R2)
}

/**
 * TG 直连 (主人): 服务端开关 + 本机 Bot 令牌。令牌只存本机 (Keystore 加密), 不上传;
 * 开了以后下载 Drive 上的文件时从 TG 并发拉, 某片没有令牌或 file_id 失效时这一片走 Drive。
 */
@Composable
private fun DirectGroup(on: Boolean, save: (JSONObject) -> Unit) {
    val context = LocalContext.current
    var bots by remember { mutableStateOf(TgBots.summary(context)) }
    var input by remember { mutableStateOf("") }
    var msg by remember { mutableStateOf("") }
    SettingsGroup("TG 直连", "Bot 令牌只存在这台手机 (系统密钥库加密), 等于这个 Bot 的全部权限; 手机丢了请在 BotFather 重置令牌并更新 Drive 后台。") {
        SwitchRow("从 TG 直接下载 Drive 上的文件", on, "字节不经过 Worker, 多片并发; 走 App 的代理") { save(JSONObject().put("direct", it)) }
        RowDivider(false)
        InfoRow("本机 Bot 令牌", if (bots.isEmpty()) "没有" else bots.joinToString(", "))
        RowDivider(false)
        InputRow("令牌", input, "123456:ABC..., 多个用逗号分开", secret = true) { input = it }
        RowDivider(false)
        ActionRow("保存令牌 (覆盖原来的)", "check", enabled = input.isNotBlank()) {
            val err = TgBots.save(context, input.split(',', '\n', ' '))
            msg = err ?: "已保存"
            if (err == null) {
                input = ""
                bots = TgBots.summary(context)
            }
        }
        if (bots.isNotEmpty()) {
            RowDivider(false)
            ActionRow("清除本机令牌", "trash-2", danger = true) {
                TgBots.save(context, emptyList())
                bots = emptyList()
                msg = "已清除"
            }
        }
        if (msg.isNotEmpty()) {
            RowDivider(false)
            NoteRow(msg)
        }
    }
}

/**
 * 迁移: 把已有文件整体搬到另一个后端 (文件 id 不变, 已发的消息照常能下载), 跑的时候每 3 秒刷新进度;
 * 冷迁移: 每天把多少天没下载过的 R2 文件搬到 Drive。
 */
@Composable
private fun MigrateGroup(coldDays: Int, onDone: () -> Unit, saveRoute: (JSONObject) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var job by remember { mutableStateOf<JSONObject?>(null) }
    var tick by remember { mutableIntStateOf(0) }
    var error by remember { mutableStateOf("") }
    val running = job != null && !job!!.has("finished")
    LaunchedEffect(tick) {
        val r = withContext(Dispatchers.IO) { Api.call(context, "GET", listOf(MIGRATE_API)) }
        job = r.body?.optJSONObject("job")
        if (r.error != null) error = r.error
        if (job != null && !job!!.has("finished")) {
            delay(MIGRATE_POLL_MS)
            tick++
        } else if (tick > 0) onDone()
    }
    val act = { method: String, body: JSONObject? ->
        scope.launch {
            val r = withContext(Dispatchers.IO) { Api.call(context, method, listOf(MIGRATE_API), body) }
            error = r.error.orEmpty()
            tick++
        }
    }
    SettingsGroup("迁移", "搬已有文件, 文件 id 不变, 已发的消息照常能下载; 搬回 R2 只搬 95 MB 以内的。") {
        job?.let { InfoRow(if (running) "进行中" else "上次", jobText(it)) }
        job?.optString("error")?.takeIf { it.isNotEmpty() }?.let {
            RowDivider(false)
            NoteRow(it, Aioa.colors.warning)
        }
        if (job != null) RowDivider(false)
        if (running) {
            ActionRow("停止迁移", "x", danger = true) { act("DELETE", null) }
        } else {
            ActionRow("全部搬到 Drive", "hard-drive") { act("POST", JSONObject().put("to", STORE_CFD)) }
            RowDivider(false)
            ActionRow("全部搬回 R2", "archive") { act("POST", JSONObject().put("to", STORE_R2)) }
        }
        RowDivider(false)
        OptionRow("冷迁移: 多少天没下载的 R2 文件每天搬到 Drive", COLD_DAYS.map { "$it" to if (it == 0) "关闭" else "$it 天" }, "$coldDays") {
            saveRoute(JSONObject().put("coldDays", it.toInt()))
        }
        if (error.isNotEmpty()) {
            RowDivider(false)
            NoteRow(error, Aioa.colors.danger)
        }
    }
}

private fun jobText(j: JSONObject): String {
    val to = if (j.optString("to") == STORE_CFD) "到 Drive" else "回 R2"
    val cold = if (j.optBoolean("cold")) "冷迁移 " else ""
    val parts = mutableListOf("$cold$to: 已搬 ${j.optInt("moved")} 个 (${FileTransfer.sizeText(j.optLong("bytes"))})")
    if (!j.has("finished")) parts += "剩 ${j.optInt("left")}"
    if (j.optInt("failed") > 0) parts += "失败 ${j.optInt("failed")}"
    if (j.optInt("skipped") > 0) parts += "跳过 ${j.optInt("skipped")}"
    return parts.joinToString(" · ")
}

@Composable
private fun OptionRow(title: String, options: List<Pair<String, String>>, selected: String, onPick: (String) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, Aioa.colors.text, LABEL_SP)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            options.forEach { (value, label) -> Chip(label, value == selected) { if (value != selected) onPick(value) } }
        }
    }
}

/** 改存储路由; 返回错误原因, 成功为空。 */
private fun saveRoute(context: Context, patch: JSONObject): String =
    Api.call(context, "PATCH", listOf(SETTINGS_API), JSONObject().put(KEY_STORAGE, patch)).error.orEmpty()
