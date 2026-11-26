package com.hengxin.aioa.link

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile

/** 一次待办提醒: key 与服务端的去重键一致 (todo:<群>:<待办 id>:<时刻>), 同一次提醒本地和推送只响一次。 */
data class TodoAlarmPlan(val key: String, val at: Long, val channel: String, val title: String, val text: String, val alarm: Boolean)

/**
 * 待办到点提醒的本地闹钟 (#105): 不靠长连, 断网也会响。UI 进程拉到待办后重排; 开机, 升级, 精确闹钟权限变化后
 * 由 :link 进程按存的计划补挂。闹钟要的内容都放在 Intent 里; 计划和 "已响过" 存文件, 两个进程都会读写,
 * 所以改文件时拿文件锁, 写先写临时文件再改名, 不会读到半截。
 */
object TodoAlarms {
    const val ACTION_FIRE = "com.hengxin.aioa.TODO_ALARM"
    const val ACTION_STOP = "com.hengxin.aioa.TODO_ALARM_STOP"
    const val EXTRA_KEY = "key"
    private const val EXTRA_AT = "at"
    private const val EXTRA_CHANNEL = "channel"
    private const val EXTRA_TITLE = "title"
    private const val EXTRA_TEXT = "text"
    private const val EXTRA_ALARM = "alarm"
    private const val PLAN_FILE = "todo_alarms.json"
    private const val FIRED_FILE = "todo_fired.json"
    private const val LOCK_FILE = "todo_alarms.lock"
    private const val URI_SCHEME = "aioa-todo"
    // 本地最多挂这么多个 (最近的), 更远的等下次重排
    private const val MAX_PLANS = 64
    private const val FIRED_KEEP = 200
    // 刚过去一分钟内的还挂 (马上响), 更早的交给服务端消息
    private const val GRACE_MS = 60_000L

    fun key(channel: String, id: String, at: Long) = "todo:$channel:$id:$at"

    fun sync(context: Context, all: List<TodoAlarmPlan>) = locked(context) {
        val now = System.currentTimeMillis()
        val fired = fired(context).toSet()
        val plans = all.filter { it.at > now - GRACE_MS && it.key !in fired }.sortedBy { it.at }.take(MAX_PLANS)
        val am = context.getSystemService(AlarmManager::class.java) ?: return@locked
        val keep = plans.map { it.key }.toSet()
        for (old in load(context)) if (old.key !in keep) am.cancel(pending(context, old.key, null))
        plans.forEach { schedule(context, am, it) }
        writeAtomic(context, PLAN_FILE, JSONArray(plans.map(::toJson)).toString())
    }

    /** 开机 / 升级 / 权限变化后: 按存的计划补挂 (系统会清掉闹钟, 或之前只能挂不精确的)。 */
    fun restore(context: Context) = locked(context) {
        val am = context.getSystemService(AlarmManager::class.java) ?: return@locked
        val now = System.currentTimeMillis()
        val fired = fired(context).toSet()
        load(context).filter { it.at > now - GRACE_MS && it.key !in fired }.forEach { schedule(context, am, it) }
    }

    /** 这次提醒已经响过 (本地闹钟或推送): 推送来的同一次不再弹。 */
    fun handled(context: Context, key: String): Boolean = key in fired(context)

    /** 记一次已响并撤掉还没响的本地闹钟; 返回 false 表示之前响过了。推送先到时也走这里, 本地就不再响。 */
    fun consume(context: Context, key: String): Boolean = locked(context) {
        val list = fired(context)
        if (key in list) return@locked false
        writeAtomic(context, FIRED_FILE, JSONArray((list + key).takeLast(FIRED_KEEP)).toString())
        context.getSystemService(AlarmManager::class.java)?.cancel(pending(context, key, null))
        true
    }

    fun planOf(intent: Intent): TodoAlarmPlan? {
        val key = intent.getStringExtra(EXTRA_KEY) ?: return null
        return TodoAlarmPlan(key, intent.getLongExtra(EXTRA_AT, 0), intent.getStringExtra(EXTRA_CHANNEL).orEmpty(), intent.getStringExtra(EXTRA_TITLE).orEmpty(), intent.getStringExtra(EXTRA_TEXT).orEmpty(), intent.getBooleanExtra(EXTRA_ALARM, false))
    }

    private fun schedule(context: Context, am: AlarmManager, p: TodoAlarmPlan) {
        val pi = pending(context, p.key, p)
        val exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()
        // 检查和调用之间权限可能被撤掉: 抛 SecurityException 时退成不精确的 (打盹时也会唤醒, 可能晚几分钟)
        runCatching {
            when {
                !exact -> am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, p.at, pi)
                p.alarm -> am.setAlarmClock(AlarmManager.AlarmClockInfo(p.at, NotifyKit.openGroup(context, p.channel)), pi)
                else -> am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, p.at, pi)
            }
        }.onFailure { runCatching { am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, p.at, pi) } }
    }

    // data 用 key 拼的地址, 每次提醒的 PendingIntent 各不相同 (只靠 requestCode 的哈希会撞); 撤销时 p 可为空
    private fun pending(context: Context, key: String, p: TodoAlarmPlan?): PendingIntent {
        val intent = Intent(context, TodoAlarmReceiver::class.java).setAction(ACTION_FIRE).setData(Uri.parse("$URI_SCHEME:${Uri.encode(key)}")).putExtra(EXTRA_KEY, key)
        if (p != null) intent.putExtra(EXTRA_AT, p.at).putExtra(EXTRA_CHANNEL, p.channel).putExtra(EXTRA_TITLE, p.title).putExtra(EXTRA_TEXT, p.text).putExtra(EXTRA_ALARM, p.alarm)
        return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    private fun toJson(p: TodoAlarmPlan) = JSONObject().put("key", p.key).put("at", p.at).put("channel", p.channel).put("title", p.title).put("text", p.text).put("alarm", p.alarm)

    private fun load(context: Context): List<TodoAlarmPlan> = runCatching {
        val arr = JSONArray(File(context.filesDir, PLAN_FILE).readText())
        (0 until arr.length()).map { arr.getJSONObject(it) }.map {
            TodoAlarmPlan(it.getString("key"), it.getLong("at"), it.optString("channel"), it.optString("title"), it.optString("text"), it.optBoolean("alarm"))
        }
    }.getOrDefault(emptyList())

    private fun fired(context: Context): List<String> = runCatching {
        val arr = JSONArray(File(context.filesDir, FIRED_FILE).readText())
        (0 until arr.length()).map { arr.getString(it) }
    }.getOrDefault(emptyList())

    private fun writeAtomic(context: Context, name: String, text: String) {
        val tmp = File(context.filesDir, "$name.tmp")
        runCatching {
            tmp.writeText(text)
            tmp.renameTo(File(context.filesDir, name))
        }
    }

    // 跨进程的读改写互斥: UI 进程排程与 :link 进程记已响用同一把文件锁
    private fun <T> locked(context: Context, block: () -> T): T =
        RandomAccessFile(File(context.filesDir, LOCK_FILE), "rw").use { f -> f.channel.lock().use { block() } }
}
