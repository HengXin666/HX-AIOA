package com.hengxin.aioa.ui

import com.hengxin.aioa.kit.PanelSize
import com.hengxin.aioa.kit.Space
import com.hengxin.aioa.kit.SpaceAction
import com.hengxin.aioa.kit.SpaceBind
import com.hengxin.aioa.kit.SpaceItem
import com.hengxin.aioa.kit.SpaceLayout
import com.hengxin.aioa.kit.SpacePanel
import org.json.JSONArray
import org.json.JSONObject

private const val KEY_ID = "id"
private const val KEY_TITLE = "title"
private const val KEY_ICON = "icon"
private const val KEY_ORDER = "order"
private const val KEY_SIZES = "sizes"
private const val KEY_HIDDEN_PANELS = "hiddenPanels"
private const val KEY_PINNED = "pinned"

// 工作台 JSON → 组件库模型, 只在界面进程使用 (:link 进程只转发原文); 对应 protocol/src/v1/space.ts
object SpaceDecode {

    fun space(o: JSONObject): Space = Space(
        id = o.getString(KEY_ID),
        title = o.optString(KEY_TITLE),
        icon = opt(o, KEY_ICON),
        origin = opt(o, "origin"),
        panels = list(o.optJSONArray("panels"), ::panel),
        layout = o.optJSONObject("state")?.let(::layout) ?: SpaceLayout(),
    )

    fun layout(o: JSONObject): SpaceLayout {
        val sizes = o.optJSONObject(KEY_SIZES)
        return SpaceLayout(
            hidden = o.optBoolean("hidden"),
            pinned = if (o.has(KEY_PINNED) && !o.isNull(KEY_PINNED)) o.optBoolean(KEY_PINNED) else null,
            hiddenPanels = strings(o.optJSONArray(KEY_HIDDEN_PANELS)),
            order = strings(o.optJSONArray(KEY_ORDER)),
            sizes = sizes?.keys()?.asSequence()?.mapNotNull { k -> PanelSize.of(sizes.optString(k))?.let { k to it } }?.toMap().orEmpty(),
        )
    }

    /** PUT /spaces/{id}/state 的请求体: 只发这次改动涉及的字段。 */
    fun layoutPatch(layout: SpaceLayout, sizesChanged: Boolean): JSONObject {
        val o = JSONObject()
        if (sizesChanged) {
            o.put(KEY_SIZES, JSONObject().apply { layout.sizes.forEach { (k, v) -> put(k, v.key) } })
        } else {
            o.put(KEY_ORDER, JSONArray(layout.order))
        }
        return o
    }

    private fun panel(o: JSONObject): SpacePanel {
        val refresh = o.optJSONObject("refresh")
        return SpacePanel(
            id = o.getString(KEY_ID),
            title = o.optString(KEY_TITLE),
            icon = opt(o, KEY_ICON),
            size = PanelSize.of(opt(o, "size")),
            everySec = refresh?.takeIf { it.optString("mode") == "interval" }?.optInt("everySec"),
            items = list(o.optJSONArray("items"), ::item),
        )
    }

    private fun item(o: JSONObject): SpaceItem = SpaceItem(
        id = o.getString(KEY_ID),
        type = o.getString("type"),
        title = opt(o, KEY_TITLE),
        icon = opt(o, KEY_ICON),
        question = opt(o, "question"),
        binds = list(o.optJSONArray("bind")) { SpaceBind(it.getString("subject"), it.getString("field"), opt(it, "source"), opt(it, "range")) },
        props = o.optJSONObject("props")?.let(::plain).orEmpty(),
        action = o.optJSONObject("action")?.let { SpaceAction(it.getString("agent"), it.getString("command"), it.optBoolean("danger")) },
    )

    private fun plain(o: JSONObject): Map<String, Any?> = o.keys().asSequence().associateWith { k ->
        when (val v = o.opt(k)) {
            is JSONArray -> (0 until v.length()).map { v.opt(it) }
            JSONObject.NULL -> null
            else -> v
        }
    }

    private fun strings(a: JSONArray?): List<String> =
        a?.let { arr -> (0 until arr.length()).mapNotNull { arr.opt(it) as? String } }.orEmpty()

    // 逐项解析, 单项坏了只丢这一项
    private fun <T> list(a: JSONArray?, map: (JSONObject) -> T): List<T> =
        a?.let { arr -> (0 until arr.length()).mapNotNull { i -> arr.optJSONObject(i)?.let { runCatching { map(it) }.getOrNull() } } }.orEmpty()

    private fun opt(o: JSONObject, key: String): String? = if (o.isNull(key)) null else o.optString(key).ifEmpty { null }
}
