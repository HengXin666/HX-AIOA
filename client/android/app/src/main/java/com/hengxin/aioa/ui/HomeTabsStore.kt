package com.hengxin.aioa.ui

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.hengxin.aioa.Constants
import com.hengxin.aioa.net.Api
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

private const val PREFS_TABS = "home-tabs"
private const val KEY_ORDER = "order"
private const val KEY_PINS = "pins"
private const val KEY_ICONS = "icons"
// 旧版只存本机; 见过一次服务端设置后就不再往上迁
private const val KEY_MIGRATED = "migrated"
// 本机改了但还没存到服务端 (离线), 下次收到设置时先把本机的推上去
private const val KEY_DIRTY = "dirty"
private const val PATCH = "PATCH"

/** homeTabs 的值: 顺序, 内置页面的置顶, 内置页面的自选图标 (#142)。 */
data class HomeTabsValue(val order: List<String> = emptyList(), val pins: Map<String, Boolean> = emptyMap(), val icons: Map<String, String> = emptyMap()) {
    val empty: Boolean get() = order.isEmpty() && pins.isEmpty() && icons.isEmpty()
}

/** homeTabs 的 JSON 与 [HomeTabsValue] 互转, 对应 protocol/src/v1/home-tabs.ts。 */
object HomeTabsJson {
    fun encode(v: HomeTabsValue): JSONObject? {
        if (v.empty) return null
        val o = JSONObject().put(KEY_ORDER, JSONArray(v.order)).put(KEY_PINS, JSONObject().apply { v.pins.forEach { (k, b) -> put(k, b) } })
        if (v.icons.isNotEmpty()) o.put(KEY_ICONS, JSONObject().apply { v.icons.forEach { (k, i) -> put(k, i) } })
        return o
    }

    fun decode(o: JSONObject): HomeTabsValue {
        val a = o.optJSONArray(KEY_ORDER) ?: JSONArray()
        val p = o.optJSONObject(KEY_PINS) ?: JSONObject()
        val i = o.optJSONObject(KEY_ICONS) ?: JSONObject()
        val order = (0 until a.length()).mapNotNull { a.optString(it).ifEmpty { null } }.distinct()
        val pins = p.keys().asSequence().filter { p.opt(it) is Boolean }.associateWith { p.getBoolean(it) }
        val icons = i.keys().asSequence().filter { i.opt(it) is String }.associateWith { i.getString(it) }
        return HomeTabsValue(order, pins, icons)
    }
}

/**
 * 首页一级页面的顺序与内置页面的置顶 (#139): 跟账号走, 存账号设置 homeTabs (设置本来就在拉, 0 额外请求),
 * 本机留一份缓存作离线兜底。旧版存在本机的值, 第一次收到服务端设置且那边还没有时迁上去。
 * 插件空间的置顶不在这里, 走 PUT spaces/{id}/state 的 pinned。
 */
class HomeTabsStore(private val context: Context, private val scope: CoroutineScope) {
    private val prefs = context.getSharedPreferences(PREFS_TABS, Context.MODE_PRIVATE)

    /** 一级页面 id 的顺序; 空表示默认顺序。 */
    var order by mutableStateOf(loadOrder())
        private set

    /** 内置页面 (总览以外) 显式设过的置顶: id → 开 / 关; 没设过的按默认补空位。 */
    var pins by mutableStateOf(loadPins())
        private set

    /** 内置页面的自选图标 (#142): id → 图标引用; 没设过的用默认图标。 */
    var icons by mutableStateOf(loadIcons())
        private set

    /** 账号设置下发 (启动时拉的一份, 或其它设备改了推来的 settings 帧)。 */
    fun apply(settings: JSONObject) {
        val v = settings.optJSONObject(Constants.SETTING_HOME_TABS)?.let(HomeTabsJson::decode) ?: HomeTabsValue()
        val same = v == current()
        val firstTime = !prefs.getBoolean(KEY_MIGRATED, false)
        val legacy = firstTime && !settings.has(Constants.SETTING_HOME_TABS) && (order.isNotEmpty() || pins.isNotEmpty())
        when {
            same -> prefs.edit().putBoolean(KEY_DIRTY, false).apply()
            // 本机有没存上去的改动, 或旧版本机值第一次迁移: 以本机为准推上去
            prefs.getBoolean(KEY_DIRTY, false) || legacy -> push()
            // 服务端为准; 服务端没有 (没设过, 或别的设备恢复了默认) 就清掉本机缓存
            else -> cache(v)
        }
        if (firstTime) prefs.edit().putBoolean(KEY_MIGRATED, true).apply()
    }

    fun saveOrder(ids: List<String>) {
        cache(current().copy(order = ids))
        push()
    }

    fun setPin(id: String, on: Boolean) {
        cache(current().copy(pins = pins + (id to on)))
        push()
    }

    /** 换内置页面的图标; null 回到默认。 */
    fun setIcon(id: String, icon: String?) {
        cache(current().copy(icons = if (icon == null) icons - id else icons + (id to icon)))
        push()
    }

    /** 恢复默认: 顺序与内置页面的置顶都清掉, 自选图标保留 (图标不算排序)。 */
    fun reset() {
        cache(HomeTabsValue(icons = icons))
        push()
    }

    private fun current() = HomeTabsValue(order, pins, icons)

    private fun cache(v: HomeTabsValue) {
        order = v.order
        pins = v.pins
        icons = v.icons
        prefs.edit().putString(KEY_ORDER, v.order.joinToString("\n"))
            .putString(KEY_PINS, v.pins.entries.joinToString("\n") { "${it.key}=${if (it.value) 1 else 0}" })
            .putString(KEY_ICONS, v.icons.entries.joinToString("\n") { "${it.key}=${it.value}" }).apply()
    }

    private fun push() {
        prefs.edit().putBoolean(KEY_DIRTY, true).apply()
        val body = JSONObject().put(Constants.SETTING_HOME_TABS, HomeTabsJson.encode(current()) ?: JSONObject.NULL)
        scope.launch(Dispatchers.IO) {
            val r = Api.call(context, PATCH, listOf(Constants.SETTINGS_PATH), body)
            if (r.error == null) prefs.edit().putBoolean(KEY_DIRTY, false).apply()
        }
    }

    private fun loadOrder(): List<String> = prefs.getString(KEY_ORDER, null)?.split("\n")?.filter { it.isNotEmpty() }.orEmpty()

    private fun loadIcons(): Map<String, String> = prefs.getString(KEY_ICONS, null)?.split("\n")
        ?.mapNotNull { l -> l.split("=", limit = 2).takeIf { it.size == 2 }?.let { (k, v) -> k to v } }?.toMap().orEmpty()

    private fun loadPins(): Map<String, Boolean> = prefs.getString(KEY_PINS, null)?.split("\n")
        ?.mapNotNull { l -> l.split("=").takeIf { it.size == 2 }?.let { (k, v) -> k to (v == "1") } }?.toMap().orEmpty()
}
