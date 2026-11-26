package com.hengxin.aioa.link

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** 一次待办提醒: key 与服务端的去重键一致 (todo:<群>:<待办 id>:<时刻>), 同一次提醒本地和推送只响一次。 */
data class TodoAlarmPlan(val key: String, val at: Long, val channel: String, val title: String, val text: String, val alarm: Boolean)

/**
 * 待办到点提醒的本地闹钟 (#105): 不靠长连, 断网也会响。UI 进程拉到待办后重排; 开机或升级后由 :link 进程按存的计划补挂。
 * 计划和已响过的键存在文件里 (两个进程都读写, 不用 SharedPreferences 的进程内缓存)。
 */
object TodoAlarms {
    const val ACTION_FIRE = "com.hengxin.aioa.TODO_ALARM"
    const val ACTION_STOP = "com.hengxin.aioa.TODO_ALARM_STOP"
    const val EXTRA_KEY = "key"
    private const val PLAN_FILE = "todo_alarms.json"
    private const val FIRED_FILE = "todo_fired.json"
    // 本地最多挂这么多个 (最近的), 更远的等下次重排
    private const val MAX_PLANS = 64
    private const val FIRED_KEEP = 200
    // 刚过去一分钟内的还挂 (马上响), 更早的交给服务端消息
    private const val GRACE_MS = 60_000L
    private val lock = Any()

    fun key(channel: String, id: String, at: Long) = "todo:$channel:$id:$at"

    fun sync(context: Context, all: List<TodoAlarmPlan>) = synchronized(lock) {
        val now = System.currentTimeMillis()
        val fired = fired(context)
        val plans = all.filter { it.at > now - GRACE_MS && it.key !in fired }.sortedBy { it.at }.take(MAX_PLANS)
        val am = context.getSystemService(AlarmManager::class.java) ?: return
        val keep = plans.map { it.key }.toSet()
        for (old in load(context)) if (old.key !in keep) am.cancel(pending(context, old))
        plans.forEach { schedule(context, am, it) }
        save(context, plans)
    }

    /** 开机 / 升级后系统清掉了闹钟: 按存的计划补挂。 */
    fun restore(context: Context) = synchronized(lock) {
        val am = context.getSystemService(AlarmManager::class.java) ?: return
        val now = System.currentTimeMillis()
        load(context).filter { it.at > now - GRACE_MS }.forEach { schedule(context, am, it) }
    }

    fun plan(context: Context, key: String): TodoAlarmPlan? = synchronized(lock) { load(context).firstOrNull { it.key == key } }

    /** 本地已经挂了或已经响过: 服务端推来的同一次提醒不再弹。 */
    fun handled(context: Context, key: String): Boolean = synchronized(lock) { key in fired(context) || load(context).any { it.key == key } }

    /** 记一次已响; 返回 false 表示之前响过了。 */
    fun markFired(context: Context, key: String): Boolean = synchronized(lock) {
        val list = fired(context)
        if (key in list) return false
        val next = (list + key).takeLast(FIRED_KEEP)
        runCatching { File(context.filesDir, FIRED_FILE).writeText(JSONArray(next).toString()) }
        true
    }

    private fun schedule(context: Context, am: AlarmManager, p: TodoAlarmPlan) {
        val pi = pending(context, p)
        val exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()
        when {
            // 没有精确闹钟权限时退成不精确的 (仍会在打盹时唤醒, 可能晚几分钟)
            !exact -> am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, p.at, pi)
            p.alarm -> am.setAlarmClock(AlarmManager.AlarmClockInfo(p.at, NotifyKit.openGroup(context, p.channel)), pi)
            else -> am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, p.at, pi)
        }
    }

    private fun pending(context: Context, p: TodoAlarmPlan): PendingIntent = PendingIntent.getBroadcast(
        context,
        p.key.hashCode(),
        Intent(context, TodoAlarmReceiver::class.java).setAction(ACTION_FIRE).putExtra(EXTRA_KEY, p.key),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    private fun load(context: Context): List<TodoAlarmPlan> = runCatching {
        val arr = JSONArray(File(context.filesDir, PLAN_FILE).readText())
        (0 until arr.length()).map { arr.getJSONObject(it) }.map {
            TodoAlarmPlan(it.getString("key"), it.getLong("at"), it.optString("channel"), it.optString("title"), it.optString("text"), it.optBoolean("alarm"))
        }
    }.getOrDefault(emptyList())

    private fun save(context: Context, plans: List<TodoAlarmPlan>) {
        val arr = JSONArray(plans.map { JSONObject().put("key", it.key).put("at", it.at).put("channel", it.channel).put("title", it.title).put("text", it.text).put("alarm", it.alarm) })
        runCatching { File(context.filesDir, PLAN_FILE).writeText(arr.toString()) }
    }

    private fun fired(context: Context): List<String> = runCatching {
        val arr = JSONArray(File(context.filesDir, FIRED_FILE).readText())
        (0 until arr.length()).map { arr.getString(it) }
    }.getOrDefault(emptyList())
}
