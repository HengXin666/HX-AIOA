package com.hengxin.aioa.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.saveable.SaveableStateHolder
import androidx.compose.runtime.staticCompositionLocalOf

/** 整个主界面共用的页面状态仓库: 进子页再返回时, 原页面的滚动位置与 rememberSaveable 状态原样恢复。 */
val LocalPageStates = staticCompositionLocalOf<SaveableStateHolder?> { null }

/** 按 key 保住一页的状态; 同一个 key 再次出现时恢复, 不重新从头开始。 */
@Composable
fun KeepState(key: String, content: @Composable () -> Unit) {
    val holder = LocalPageStates.current
    if (holder == null) content() else holder.SaveableStateProvider(key, content)
}

/** 页面在内存里的数据缓存: 返回时先显示上次的内容, 后台再刷新, 不闪 "加载中"。 */
object PageCache {
    private val map = HashMap<String, Any>()

    @Suppress("UNCHECKED_CAST")
    fun <T : Any> get(key: String): T? = synchronized(map) { map[key] as? T }

    fun put(key: String, value: Any) = synchronized(map) { map[key] = value }
}
