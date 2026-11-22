package com.hengxin.aioa.link

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import com.hengxin.aioa.Constants
import com.hengxin.aioa.R
import com.hengxin.aioa.net.Api
import org.json.JSONObject
import java.util.UUID

/** 通知上的 "批准" "拒绝": 走 POST api/v1/tasks/{id}/actions 提交, 与界面里的 act 帧等价; 点下后立即去掉按钮, 避免重复提交。 */
class AgentActionReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val taskId = intent.getStringExtra(EXTRA_TASK) ?: return
        val kind = intent.getStringExtra(EXTRA_KIND) ?: return
        val app = context.applicationContext
        val tag = EventNotifier.taskTag(taskId)
        show(app, tag, app.getString(R.string.notify_agent_sending), ongoing = true)
        val pending = goAsync()
        Thread {
            try {
                val body = JSONObject().put(KEY_AID, AID_PREFIX + UUID.randomUUID().toString().replace("-", "").take(AID_LENGTH)).put(KEY_KIND, kind)
                val reply = Api.call(app, METHOD_POST, listOf(Constants.TASKS_PATH, taskId, PATH_ACTIONS), body)
                val error = reply.error
                if (error == null) {
                    val done = if (kind == Constants.ACT_APPROVE) R.string.notify_agent_done_approve else R.string.notify_agent_done_reject
                    show(app, tag, app.getString(done), ongoing = false, timeout = DONE_TIMEOUT_MS)
                    LinkLog.add(app, "通知里提交了任务动作 $kind")
                } else {
                    show(app, tag, app.getString(R.string.notify_agent_failed, error), ongoing = false)
                }
            } finally {
                pending.finish()
            }
        }.start()
    }

    // 覆盖原来那条待确认通知, 去掉按钮, 避免重复提交
    private fun show(context: Context, tag: String, text: String, ongoing: Boolean, timeout: Long = 0) {
        val b = NotifyKit.builder(context, Constants.CHANNEL_AGENT, R.drawable.ic_stat_agent)
            .setContentTitle(context.getString(R.string.channel_agent))
            .setContentText(text)
            .setContentIntent(NotifyKit.openApp(context))
            .setGroup(Constants.GROUP_AGENT)
            .setOngoing(ongoing)
            .setAutoCancel(!ongoing)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
        if (ongoing) b.setProgress(0, 0, true)
        if (timeout > 0) b.setTimeoutAfter(timeout)
        NotifyKit.post(context, tag, Constants.NOTIFY_ID_AGENT, b.build())
    }

    companion object {
        const val EXTRA_TASK = "taskId"
        const val EXTRA_KIND = "kind"
        private const val KEY_AID = "aid"
        private const val KEY_KIND = "kind"
        private const val AID_PREFIX = "n_"
        private const val AID_LENGTH = 16
        private const val METHOD_POST = "POST"
        private const val PATH_ACTIONS = "actions"
        private const val DONE_TIMEOUT_MS = 5000L
    }
}
