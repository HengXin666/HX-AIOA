package com.hengxin.aioa.link

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.hengxin.aioa.Constants
import com.hengxin.aioa.config.Auth
import com.hengxin.aioa.config.ConfigStore
import com.hengxin.aioa.net.Net
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/**
 * 待办闹钟到点: 先花几秒向服务端确认这条还要提醒 (可能已在别处完成, 删除或改了时间, 手机界面没打开过就不知道),
 * 查不到 (断网, 超时) 照样提醒。跑在 :link 进程, 不碰界面类。
 */
class TodoAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val key = intent.getStringExtra(TodoAlarms.EXTRA_KEY) ?: return
        if (intent.action == TodoAlarms.ACTION_STOP) return NotifyKit.cancel(context, key, Constants.NOTIFY_ID_TODO)
        val p = TodoAlarms.planOf(intent) ?: return
        val done = goAsync()
        thread {
            try {
                if (stillDue(context, p) && TodoAlarms.consume(context, key)) TodoNotify.post(context, p)
            } finally {
                done.finish()
            }
        }
    }

    // 行 id 与提醒时刻从 key 里拆: todo:<群>:<待办 id>:<时刻>
    private fun stillDue(context: Context, p: TodoAlarmPlan): Boolean {
        val rowId = p.key.removePrefix(KEY_PREFIX).substringBeforeLast(':')
        val config = ConfigStore.load(context) ?: return true
        return runCatching {
            val url = config.server.toHttpUrl().newBuilder().addPathSegments(Constants.PDATA_API).addPathSegment(Constants.TODO_PLUGIN).addPathSegment(Constants.TODO_COLL).addPathSegment(rowId).build()
            val req = Request.Builder().url(url).header("Authorization", "Bearer ${Auth.bearer(context, config)}").build()
            val client = Net.client(context).newBuilder().callTimeout(CHECK_TIMEOUT_S, TimeUnit.SECONDS).build()
            client.newCall(req).execute().use { res ->
                when {
                    res.code == HTTP_NOT_FOUND -> false
                    !res.isSuccessful -> true
                    else -> {
                        val item = JSONObject(res.body?.string().orEmpty()).optJSONObject("item") ?: return@use true
                        val b = item.optJSONObject("body")
                        if (item.optBoolean("deleted") || b == null) return@use false
                        val finished = b.optString("state") in FINISHED
                        val at = if (b.has("due") && b.has("remind")) b.optLong("due") - b.optInt("remind") * MINUTE_MS else -1
                        !finished && at == p.at
                    }
                }
            }
        }.getOrDefault(true)
    }

    private companion object {
        const val KEY_PREFIX = "todo:"
        const val CHECK_TIMEOUT_S = 4L
        const val HTTP_NOT_FOUND = 404
        const val MINUTE_MS = 60_000L
        val FINISHED = setOf("done", "dropped")
    }
}
