package com.hengxin.aioa.ui.chat

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.hengxin.aioa.R
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.GeneratedTokens
import com.hengxin.aioa.net.ApiFailure
import com.hengxin.aioa.net.ErrKind
import com.hengxin.aioa.net.TransferService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/** 一次头像上传: progress 0..1; 失败时 error 非空并留着裁好的图供重试; 成功时 done 为新头像 id。 */
data class AvatarJob(
    val bytes: ByteArray,
    val progress: Float = 0f,
    val error: String? = null,
    val kind: ErrKind? = null,
    val done: String? = null,
) {
    val running get() = error == null && done == null
}

/**
 * 头像上传放在应用级作用域, 不随页面销毁: 离开页面或切到后台继续传, 回到页面读同一份状态。
 * 传输期间起 [TransferService] 前台服务保活并显示进度通知; 进程被杀不续传。
 */
object AvatarUploads {
    const val ME = "me"
    private const val GROUP_PREFIX = "chat:"
    private const val PROGRESS_STEP = 0.02f
    private const val PERCENT = 100

    val jobs = mutableStateMapOf<String, AvatarJob>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    fun groupKey(channel: String) = "$GROUP_PREFIX$channel"

    /** 开始上传; 服务端收下图片后调 save 把新 id 存进群资料或账号设置, save 返回错误信息, 成功为 null。 */
    fun start(context: Context, key: String, bytes: ByteArray, save: suspend (String) -> String?) {
        if (jobs[key]?.running == true) return
        val app = context.applicationContext
        jobs[key] = AvatarJob(bytes)
        report(app)
        scope.launch {
            var shown = -1f
            val r = Avatars.upload(app, bytes) { sent, total ->
                val p = if (total > 0) sent.toFloat() / total else 0f
                // 重试时进度回到 0, 也要刷新; 其余每 2% 刷一次
                if (p < shown || p - shown >= PROGRESS_STEP || (p >= 1f && shown < 1f)) {
                    shown = p
                    scope.launch { update(app, key) { it.copy(progress = p) } }
                }
            }
            val err = r.fold({ id -> save(id)?.let { e -> e to ErrKind.guess(e) } }, { it.message.orEmpty() to ((it as? ApiFailure)?.kind ?: ErrKind.OTHER) })
            val id = r.getOrNull()
            update(app, key) { if (err == null) it.copy(progress = 1f, done = id) else it.copy(error = err.first, kind = err.second) }
        }
    }

    /** 页面看过结果 (或收起错误) 后清掉。 */
    fun clear(key: String) {
        if (jobs[key]?.running == false) jobs.remove(key)
    }

    private fun update(context: Context, key: String, change: (AvatarJob) -> AvatarJob) {
        jobs[key]?.let { jobs[key] = change(it) }
        report(context)
    }

    // 有进行中的就更新通知 (到 100% 等服务端回应时显示不定进度), 全部结束就停掉前台服务
    private fun report(context: Context) {
        val live = jobs.values.filter { it.running }
        if (live.isEmpty()) return TransferService.finish(context)
        val p = live.minOf { it.progress }
        val title = context.getString(R.string.transfer_avatar)
        val text = if (p >= 1f) context.getString(R.string.transfer_waiting) else context.getString(R.string.transfer_progress, (p * PERCENT).toInt())
        TransferService.show(context, title, text, if (p >= 1f) null else (p * PERCENT).toInt())
    }
}

private const val SCRIM_ALPHA = 0.45f
private const val TRACK_ALPHA = 0.3f
private const val PCT_SCALE = 100
private val RING = 3.dp
private val ON_SCRIM = Color.White

/** 头像上盖一层圆形进度与百分比; 到 100% 还没回应时转为不定进度。没有进行中的上传就只画头像。 */
@Composable
fun UploadingAvatar(job: AvatarJob?, size: Dp, modifier: Modifier = Modifier, avatar: @Composable () -> Unit) {
    Box(modifier.size(size), contentAlignment = Alignment.Center) {
        avatar()
        if (job?.running != true) return@Box
        Box(Modifier.size(size).clip(CircleShape).background(Aioa.colors.scrim.copy(alpha = SCRIM_ALPHA)))
        val track = ON_SCRIM.copy(alpha = TRACK_ALPHA)
        if (job.progress >= 1f) {
            CircularProgressIndicator(Modifier.size(size), color = ON_SCRIM, strokeWidth = RING, trackColor = track)
        } else {
            CircularProgressIndicator({ job.progress }, Modifier.size(size), color = ON_SCRIM, strokeWidth = RING, trackColor = track)
        }
        Text("${(job.progress * PCT_SCALE).toInt()}%", color = ON_SCRIM, fontSize = GeneratedTokens.FontSize.xs, fontWeight = FontWeight.SemiBold)
    }
}
