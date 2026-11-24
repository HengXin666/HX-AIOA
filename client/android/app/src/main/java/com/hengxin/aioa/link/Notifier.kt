package com.hengxin.aioa.link

import android.app.Notification
import android.content.Context
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import com.hengxin.aioa.Constants
import com.hengxin.aioa.R
import com.hengxin.aioa.data.GroupTitles
import com.hengxin.aioa.data.MessageDb
import com.hengxin.aioa.data.groupKey
import com.hengxin.aioa.proto.Envelope
import com.hengxin.aioa.proto.ServerFrame
import com.hengxin.aioa.proto.TaskSnapshot
import com.hengxin.aioa.proto.plainLine
import com.hengxin.aioa.proto.plainText

/** :link 进程的通知入口: 常驻连接, 普通消息会话, 以及按内容分派的 v1 事件。 */
class Notifier(private val context: Context, private val db: MessageDb) {

    private val me = Person.Builder().setName(context.getString(R.string.me)).build()
    private val events = EventNotifier(context)

    fun linkNotification(): Notification =
        NotifyKit.builder(context, Constants.CHANNEL_LINK, R.drawable.ic_stat_app)
            .setContentTitle(context.getString(R.string.link_running))
            .setContentIntent(NotifyKit.openApp(context))
            .setOngoing(true)
            .setSilent(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

    /** v1 事件; msg 是它写进消息库的样子。loud 为 false 时 (安静路由, 已恢复) 只更新已有通知。 */
    fun event(ev: Envelope, msg: ServerFrame.Msg, loud: Boolean) {
        if (events.recover(ev)) return
        val task = ev.task
        when {
            task != null -> events.task(task, ev.source.name, loud)
            !loud -> Unit
            ev.kind == Constants.KIND_REPORT -> events.report(ev)
            events.isAlert(ev) -> events.alert(ev)
            events.isGithub(ev) -> events.github(ev)
            else -> message(msg)
        }
    }

    /** 消息被撤回或删除: 撤掉它的单独通知; 所在群的会话通知按剩下的未读重发 (不再响), 没有了就撤掉。 */
    fun retract(ev: Envelope, msg: ServerFrame.Msg) {
        events.retract(ev)
        val key = msg.groupKey()
        val tag = MESSAGE_TAG + key
        if (!NotifyKit.active(context, tag, Constants.NOTIFY_ID_MESSAGE)) return
        val left = db.unread(HISTORY_SCAN).lastOrNull { it.groupKey() == key }
        if (left == null) NotifyKit.cancel(context, tag, Constants.NOTIFY_ID_MESSAGE) else message(left, quiet = true)
    }

    /** 单独推来的任务快照只用于撤掉已处理的待确认通知, 不新弹。 */
    fun task(task: TaskSnapshot) = events.task(task, task.agent, loud = false)

    /** 普通消息: 同一个群合并为一条会话 (标题是群名, 每条显示发送者), 每条新消息都重新提醒一次 (横幅, 震动, 锁屏可见)。 */
    fun message(msg: ServerFrame.Msg, quiet: Boolean = false) {
        if (!NotifyKit.granted(context)) return
        val key = msg.groupKey()
        val title = GroupTitles.of(context, key)
        val history = db.unread(HISTORY_SCAN).filter { it.groupKey() == key }
            .takeLast(Constants.NOTIFY_MAX_LINES).ifEmpty { listOf(msg) }
        val people = HashMap<String, Person>()
        val style = NotificationCompat.MessagingStyle(me).setConversationTitle(title)
            .setGroupConversation(history.any { it.src != title })
        history.forEach { m -> style.addMessage(plainText(m.text), m.ts, people.getOrPut(m.src) { Person.Builder().setName(m.src).setKey(m.src).build() }) }
        val total = db.unreadCount()
        val preview = plainLine(msg.text).ifEmpty { context.getString(R.string.notify_card) }
        val line = if (msg.src == title) preview else "${msg.src}: $preview"
        val notification = NotifyKit.builder(context, Constants.CHANNEL_MESSAGE, R.drawable.ic_stat_message)
            .setContentTitle(title)
            .setContentText(line)
            .setStyle(style)
            .setNumber(history.size)
            .setContentIntent(NotifyKit.openGroup(context, key))
            .setGroup(Constants.GROUP_MESSAGE)
            .setAutoCancel(true)
            .setWhen(msg.ts)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setDefaults(NotificationCompat.DEFAULT_SOUND or NotificationCompat.DEFAULT_LIGHTS)
            .setVibrate(Constants.VIBRATE_PATTERN)
            .setSilent(quiet)
            .build()
        // 先撤掉旧的再发, 系统把它当作新通知, 每条都会重新弹横幅
        val tag = MESSAGE_TAG + key
        if (!quiet) NotificationManagerCompat.from(context).cancel(tag, Constants.NOTIFY_ID_MESSAGE)
        NotifyKit.post(context, tag, Constants.NOTIFY_ID_MESSAGE, notification)
        NotifyKit.summary(
            context,
            Constants.CHANNEL_MESSAGE,
            R.drawable.ic_stat_message,
            Constants.GROUP_MESSAGE,
            Constants.NOTIFY_ID_MESSAGE,
            context.getString(R.string.unread_title, total),
            latest = tag to NotifyKit.line(title, line),
        )
    }

    private companion object {
        const val MESSAGE_TAG = "msg:"
        // 从全部未读里挑出同一来源, 多扫一些以免被别的来源挤掉
        const val HISTORY_SCAN = 200
    }
}
