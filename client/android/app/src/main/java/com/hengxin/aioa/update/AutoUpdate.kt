package com.hengxin.aioa.update

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import com.hengxin.aioa.Constants
import com.hengxin.aioa.link.LinkLog
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.util.concurrent.atomic.AtomicBoolean

// 打开 App (回到前台) 时的自动更新: 距上次检查超过间隔才查 GitHub, 有新版且网络条件允许就后台下载,
// 下好后由界面提示 "新版本已就绪"。只在界面进程使用。
object AutoUpdate {

    @Volatile
    var foreground = false
        private set

    private val busy = AtomicBoolean(false)
    private val state = MutableStateFlow<ReleaseNote?>(null)
    val ready: StateFlow<ReleaseNote?> = state

    // 本次进程里点过 "稍后" 的版本不再弹
    @Volatile
    private var dismissed = 0L

    fun onStart(context: Context) {
        foreground = true
        val app = context.applicationContext
        if (!busy.compareAndSet(false, true)) return
        Thread {
            try {
                run(app)
            } catch (e: Exception) {
                LinkLog.add(app, "自动更新: ${e.message.orEmpty()}")
            } finally {
                busy.set(false)
            }
        }.start()
    }

    fun onStop() {
        foreground = false
    }

    fun dismiss() {
        state.value?.let { dismissed = it.versionCode }
        state.value = null
    }

    fun install(context: Context) {
        val app = context.applicationContext
        state.value = null
        Thread {
            val text = runCatching { Updater(app).installPending(true) }.getOrElse { "安装失败: ${it.message}" }
            Handler(Looper.getMainLooper()).post { Toast.makeText(app, text, Toast.LENGTH_LONG).show() }
        }.start()
    }

    private fun run(context: Context) {
        // 从 "安装未知应用" 授权页回来: 用已下载的安装包继续安装
        if (Updater.takePermissionResume(context)) {
            Updater(context).installPending(true)
            return
        }
        val s = UpdatePrefs.load(context)
        if (!s.autoCheck) return
        Updater.pendingApk(context)?.let { apk ->
            publish(context, Updater.versionOf(apk) ?: return)
            return
        }
        val now = System.currentTimeMillis()
        if (!UpdatePolicy.checkDue(now, s.lastCheck, Constants.UPDATE_INTERVAL_MS)) return
        UpdatePrefs.edit(context) { it.copy(lastCheck = now) }
        val remote = ReleaseCheck.latest(context)
        if (!UpdatePolicy.isNewer(remote, Updater(context).currentVersion())) return
        if (!UpdatePolicy.canDownload(s.autoDownload, UpdatePrefs.net(context))) return
        val note = Updater(context).downloadLatest { } ?: return
        publish(context, note.versionCode)
    }

    private fun publish(context: Context, code: Long) {
        if (code == dismissed) return
        state.value = ReleaseNotes.find(context, code) ?: ReleaseNote(code, "", emptyList())
    }
}
