package com.hengxin.aioa.update

import android.content.Context
import com.hengxin.aioa.config.JsonFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

data class ReleaseNote(val versionCode: Long, val versionName: String, val lines: List<String>)

// 更新公告: 检查更新时把 update.json 的说明存进本地历史, 新版本首次启动弹一次, 设置页可看历史
object ReleaseNotes {
    private const val FILE_NAME = "release_notes.json"
    private const val KEY_SHOWN = "shown"
    private const val KEY_NOTES = "notes"
    private const val KEY_CODE = "versionCode"
    private const val KEY_NAME = "versionName"
    private const val KEY_LINES = "lines"
    private const val KEEP = 20
    private const val BULLET = "- "

    /** update.json 里优先读 changes 数组, 旧格式只有 notes 多行文本。 */
    fun parse(json: JSONObject): List<String> {
        val changes = json.optJSONArray("changes")
        if (changes != null && changes.length() > 0) {
            return (0 until changes.length()).mapNotNull { changes.optJSONObject(it)?.optString("title")?.ifBlank { null } }
        }
        return json.optString(KEY_NOTES).lines().map { it.trim().removePrefix(BULLET).trim() }.filter { it.isNotEmpty() }
    }

    fun remember(context: Context, note: ReleaseNote) {
        val all = (history(context).filter { it.versionCode != note.versionCode } + note).sortedByDescending { it.versionCode }.take(KEEP)
        val root = read(context)
        root.put(KEY_NOTES, JSONArray(all.map { encode(it) }))
        JsonFile.write(file(context), root)
    }

    fun history(context: Context): List<ReleaseNote> {
        val arr = read(context).optJSONArray(KEY_NOTES) ?: return emptyList()
        return (0 until arr.length()).mapNotNull { arr.optJSONObject(it)?.let(::decode) }
    }

    fun find(context: Context, versionCode: Long): ReleaseNote? = history(context).firstOrNull { it.versionCode == versionCode }

    /** 当前版本还没展示过公告时返回 true, 调用方据此决定要不要找说明并弹出。 */
    fun unseen(context: Context, current: Long): Boolean = read(context).optLong(KEY_SHOWN) < current

    fun markShown(context: Context, versionCode: Long) {
        JsonFile.write(file(context), read(context).put(KEY_SHOWN, versionCode))
    }

    private fun encode(n: ReleaseNote) = JSONObject().put(KEY_CODE, n.versionCode).put(KEY_NAME, n.versionName).put(KEY_LINES, JSONArray(n.lines))

    private fun decode(o: JSONObject): ReleaseNote {
        val lines = o.optJSONArray(KEY_LINES) ?: JSONArray()
        return ReleaseNote(o.optLong(KEY_CODE), o.optString(KEY_NAME), (0 until lines.length()).map { lines.optString(it) })
    }

    private fun read(context: Context): JSONObject = JsonFile.read(file(context)) ?: JSONObject()

    private fun file(context: Context) = File(context.filesDir, FILE_NAME)
}
