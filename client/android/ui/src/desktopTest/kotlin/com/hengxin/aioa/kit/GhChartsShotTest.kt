package com.hengxin.aioa.kit

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.runDesktopComposeUiTest
import androidx.compose.ui.unit.dp
import com.github.takahirom.roborazzi.ExperimentalRoborazziApi
import io.github.takahirom.roborazzi.captureRoboImage
import kotlin.test.Test

/** #145: 走势合一双轴图 (提示框标左右轴), 可点图例 (隐藏变淡), 拆分小图联动同一格, 按年热力格首列不画补位格。 */
@OptIn(ExperimentalTestApi::class, ExperimentalRoborazziApi::class)
class GhChartsShotTest {
    private val days = List(14) { "11-${15 + it}" }
    private fun v(vararg x: Int) = x.map { it.toFloat() }

    @Test
    fun shots() {
        for (dark in listOf(false, true)) {
            runDesktopComposeUiTest(390, 900) {
                setContent {
                    AioaTheme(Appearance(dark = dark)) {
                        val p = chartPalette()
                        val commit = MixSeries("提交", v(19, 5, 6, 6, 7, 12, 21, 80, 57, 60, 83, 77, 76, 48), p.primary, MixStyle.AREA)
                        val left = listOf(
                            MixSeries("PR 新开", v(0, 1, 0, 2, 0, 1, 0, 3, 2, 4, 6, 15, 4, 2), p.accent, MixStyle.LINE),
                            MixSeries("PR 合入", v(0, 1, 0, 1, 0, 1, 0, 3, 2, 4, 5, 15, 4, 2), p.success, MixStyle.BARS),
                            MixSeries("PR 未合入关闭", v(0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0), p.danger, MixStyle.DOTS),
                            MixSeries("Issue 新开", v(1, 0, 2, 1, 0, 3, 1, 4, 6, 8, 12, 19, 23, 9), p.amber, MixStyle.DASHED),
                            MixSeries("Issue 关闭完成", v(0, 0, 1, 1, 0, 2, 1, 3, 5, 7, 9, 18, 7, 15), p.teal, MixStyle.BARS),
                            MixSeries("Issue 未完成关闭", v(0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1), p.neutral, MixStyle.DOTS),
                            MixSeries("评论", v(0, 2, 2, 2, 0, 1, 0, 4, 2, 37, 47, 28, 28, 24), p.green, MixStyle.LINE),
                        )
                        Column(Modifier.fillMaxSize().background(Aioa.colors.background).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            MixLegend(listOf(commit) + left, (listOf(commit) + left).map { "${it.values.sum().toInt()}" }, hidden = setOf("评论"), onToggle = {})
                            DualMixChart(left.dropLast(1), listOf(commit), days, height = 210.dp, selected = 10, grid = p.grid, axis = p.axis, tip = "11-25")
                            MixChart(left.subList(0, 3), days, height = 112.dp, selected = 10, grid = p.grid, axis = p.axis, tip = "11-25")
                            MixChart(listOf(commit), days, height = 112.dp, selected = 3, grid = p.grid, axis = p.axis, tip = "11-18")
                            // 2026 年: 1 月 1 日是周四, 前 3 格是补位
                            Heatmap(List(3) { -1 } + List(60) { it % 5 }, 7, p.primary, Modifier.width(130.dp).height(90.dp))
                        }
                    }
                }
                onRoot().captureRoboImage("build/outputs/roborazzi/gh_trend_combined-${if (dark) "dark" else "light"}.png")
            }
        }
    }
}
