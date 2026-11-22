package com.hengxin.aioa.kit

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.MutableTransitionState
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.remember

/**
 * 增量列表 (用于普通 Column 里): 按 key 复用每一项, 只有后来新出现的项才展开淡入,
 * 首次显示 (缓存秒出) 不播动画; 已有项内容变了原地更新, 不整体重绘。
 */
@Composable
fun <T> AnimatedItems(items: List<T>, key: (T) -> Any, content: @Composable (T) -> Unit) {
    val seen = remember { HashSet<Any>() }
    val first = remember { booleanArrayOf(true) }
    items.forEach { item ->
        val k = key(item)
        key(k) {
            val fresh = !first[0] && k !in seen
            val state = remember { MutableTransitionState(!fresh).apply { targetState = true } }
            AnimatedVisibility(state, enter = expandVertically() + fadeIn()) { content(item) }
        }
    }
    SideEffect {
        items.forEach { seen.add(key(it)) }
        if (items.isNotEmpty()) first[0] = false
    }
}
