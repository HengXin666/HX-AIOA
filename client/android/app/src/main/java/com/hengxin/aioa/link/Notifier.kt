package com.hengxin.aioa.link

import android.app.Notification
import android.content.Context
import android.util.LruCache
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import com.hengxin.aioa.Constants
import com.hengxin.aioa.R
import com.hengxin.aioa.data.GroupTitles
import com.hengxin.aioa.data.MessageDb
import com.hengxin.aioa.data.groupKey
import com.hengxin.aioa.proto.Envelope
import com.hengxin.aioa.proto.NotifyText
import com.hengxin.aioa.proto.ServerFrame
import com.hengxin.aioa.proto.TaskSnapshot
import org.json.JSONObject

/** :link 进程的通知入口: 常驻连接, 普通消息会话, 以及按内容分派的 v1 事件。 */
class Notifier(private val context: Context, private val db: MessageDb) {

    private val me = Person.Builder().setName(context.getString(R.string.me)).build()
    private val events = EventNotifier(context)
    // 信的通知正文 (验证码或要点) 按事件 id 记下, 同群后续重发时历史行也用它, 不再显示整段原文
    private val mailTexts = LruCache<String, String>(MAIL_MEMO)

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
        // 待办提醒: 本地闹钟先响过的不再弹; 推送先到就由推送提醒, 并撤掉本地还没响的同一次闹钟
        val todoKey = ev.dedupeKey?.takeIf { ev.source.id.startsWith(Constants.SOURCE_TODO_REMIND) }
        if (todoKey != null) {
            if (loud && TodoAlarms.consume(context, todoKey)) {
                val alarm = ev.source.id.endsWith(TODO_ALARM_SUFFIX)
                TodoNotify.post(context, TodoAlarmPlan(todoKey, ev.ts, ev.channel.orEmpty(), ev.title, ev.summary ?: ev.markdown.orEmpty(), alarm))
            }
            return
        }
        val task = ev.task
        when {
            task != null -> events.task(task, ev.source.name, loud)
            !loud -> Unit
            ev.kind == Constants.KIND_REPORT -> events.report(ev)
            events.isAlert(ev) -> events.alert(ev)
            events.isGithub(ev) -> events.github(ev)
            else -> message(msg, mail = mailText(ev))
        }
    }

    // 邮件群的信 (#146): 收信时服务端已提取验证码与要点, 老信没有就用摘要
    private fun mailText(ev: Envelope): String? {
        val o = ev.mail?.let { runCatching { JSONObject(it) }.getOrNull() } ?: return null
        val code = o.optJSONObject(KEY_OTP)?.optString(KEY_CODE)?.ifEmpty { null } ?: o.optString(KEY_CODE).ifEmpty { null }
        return NotifyText.mail(ev.title, code, o.optString(KEY_BRIEF).ifEmpty { null }, ev.summary)
    }

    private fun text(m: ServerFrame.Msg): String =
        m.id?.let { mailTexts.get(it) } ?: NotifyText.message(m.text, m.file, m.html != null || m.feed != null, m.bundle)

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

    /**
     * 普通消息: 同一个群合并为一条会话样式通知 (群名与群头像, 每条带发送者与头像), 挂会话快捷方式进 "对话" 区;
     * 每条新消息都重新提醒一次。锁屏跟随系统 "显示敏感内容": 隐藏时只显示 "N 条新消息"。
     */
    fun message(msg: ServerFrame.Msg, quiet: Boolean = false, mail: String? = null) {
        if (!NotifyKit.granted(context)) return
        if (mail != null) msg.id?.let { mailTexts.put(it, mail) }
        val key = msg.groupKey()
        val title = GroupTitles.of(context, key)
        val history = db.unread(HISTORY_SCAN).filter { it.groupKey() == key }
            .takeLast(Constants.NOTIFY_MAX_LINES).ifEmpty { listOf(msg) }
        val isGroup = history.any { it.src != title }
        val groupIcon = NotifyFaces.group(context, key, title)
        val people = HashMap<String, Person>()
        // 单聊 (发送者就是会话名) 用会话头像: 服务端给单聊填的就是对方头像 (#147)
        val person = { m: ServerFrame.Msg ->
            people.getOrPut(m.sid ?: m.src) {
                val icon = if (m.src == title) groupIcon else NotifyFaces.sender(context, m.sid, m.src)
                Person.Builder().setName(m.src).setKey(m.sid ?: m.src).setIcon(icon).build()
            }
        }
        val card = context.getString(R.string.notify_card)
        val style = NotificationCompat.MessagingStyle(me).setConversationTitle(title).setGroupConversation(isGroup)
        history.forEach { m -> style.addMessage(text(m).ifEmpty { card }, m.ts, person(m)) }
        val total = db.unreadCount()
        val preview = NotifyText.cut(text(msg).replace('\n', ' '), NotifyText.MAX_LINE).ifEmpty { card }
        val line = if (msg.src == title) preview else "${msg.src}: $preview"
        val sign = title + SIGN_SEP + NotifyFaces.groupAvatarId(context, key).orEmpty()
        val shortcut = Conversations.push(context, key, title, groupIcon, sign, if (isGroup) null else person(history.last()))
        val builder = NotifyKit.builder(context, Constants.CHANNEL_MESSAGE, R.drawable.ic_stat_message)
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
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(publicVersion(history.size))
            .setDefaults(NotificationCompat.DEFAULT_SOUND or NotificationCompat.DEFAULT_LIGHTS)
            .setVibrate(Constants.VIBRATE_PATTERN)
            .setSilent(quiet)
        if (shortcut) builder.setShortcutId(Conversations.id(key)).setLocusId(Conversations.locus(key))
        // 先撤掉旧的再发, 系统把它当作新通知, 每条都会重新弹横幅
        val tag = MESSAGE_TAG + key
        if (!quiet) NotificationManagerCompat.from(context).cancel(tag, Constants.NOTIFY_ID_MESSAGE)
        NotifyKit.post(context, tag, Constants.NOTIFY_ID_MESSAGE, builder.build())
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

    // 锁屏隐藏敏感内容时显示的版本: 不带群名, 发送者与正文
    private fun publicVersion(n: Int): Notification =
        NotifyKit.builder(context, Constants.CHANNEL_MESSAGE, R.drawable.ic_stat_message)
            .setContentTitle(context.getString(R.string.app_name))
            .setContentText(context.getString(R.string.unread_title, n))
            .setNumber(n)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .build()

    private companion object {
        const val MESSAGE_TAG = "msg:"
        // 从全部未读里挑出同一来源, 多扫一些以免被别的来源挤掉
        const val HISTORY_SCAN = 200
        const val MAIL_MEMO = 64
        const val SIGN_SEP = "\u0000"
        // data.mail 里的字段, 与 protocol/src/v1/mail.ts 的 MailInfo 一致
        const val KEY_OTP = "otp"
        const val KEY_CODE = "code"
        const val KEY_BRIEF = "brief"
    }
}

// 服务端给设了闹钟的待办提醒加的来源后缀, 与 server/src/plugins/todo-notice.ts 一致
private const val TODO_ALARM_SUFFIX = ":alarm"
