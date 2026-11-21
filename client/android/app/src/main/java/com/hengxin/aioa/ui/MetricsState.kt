package com.hengxin.aioa.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.hengxin.aioa.proto.MetricPoint
import com.hengxin.aioa.proto.ServerFrame

private const val KEEP_POINTS = 120

/** 实时指标的界面状态: 在线探针列表 + 每个主体最近的点。只在资源页可见时 watch, 离开即取消。 */
class MetricsState(private val sendWatch: (List<String>) -> Boolean) {
    var probes by mutableStateOf<List<String>>(emptyList())
        private set
    val samples = mutableStateMapOf<String, List<MetricPoint>>()

    // 界面当前想看的主体; 断线重连后按它重新声明
    private var watching: List<String> = emptyList()

    fun watch(subjects: List<String>) {
        watching = subjects
        sendWatch(subjects)
    }

    fun onOnline() {
        if (watching.isNotEmpty()) sendWatch(watching)
    }

    fun onFrame(frame: ServerFrame): Boolean = when (frame) {
        is ServerFrame.Probes -> {
            probes = frame.subjects
            true
        }
        is ServerFrame.Metric -> {
            val merged = if (frame.history) frame.points else samples[frame.subject].orEmpty() + frame.points
            samples[frame.subject] = merged.takeLast(KEEP_POINTS)
            true
        }
        else -> false
    }

    fun series(subject: String, key: String): List<Pair<Long, Float>> =
        samples[subject].orEmpty().mapNotNull { p -> p.values[key]?.let { p.ts to it.toFloat() } }
}
