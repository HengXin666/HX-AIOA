package com.hengxin.aioa.kit

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.runDesktopComposeUiTest
import com.github.takahirom.roborazzi.ExperimentalRoborazziApi
import io.github.takahirom.roborazzi.captureRoboImage
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

private const val TAG = "content"
private const val NOW = 1_800_000_000_000L
private const val HOUR_MS = 3_600_000L

/** 侧栏手势 (#121): 子页里划不出; 拖到一半松手必须吸附到开或关, 不停在中间。 */
@OptIn(ExperimentalTestApi::class, ExperimentalRoborazziApi::class)
class HomeShellTest {

    private fun drag(gestures: Boolean, dx: Float, steps: Int): Float {
        val state = HomeShellState()
        var result = -1f
        runDesktopComposeUiTest(400, 800) {
            setContent {
                AioaTheme(Appearance(dark = false)) {
                    HomeShell(state, sidebar = {}, gestures = gestures) { Box(Modifier.fillMaxSize().testTag(TAG)) }
                }
            }
            onNodeWithTag(TAG).performTouchInput {
                down(Offset(20f, 400f))
                repeat(steps) { moveBy(Offset(dx / steps, 0f), delayMillis = 40) }
                up()
            }
            waitForIdle()
            mainClock.advanceTimeBy(2_000)
            waitForIdle()
            result = state.fraction
        }
        return result
    }

    @Test
    fun 慢拖过半松手_吸附到开() = assertEquals(1f, drag(true, 220f, 20))

    @Test
    fun 慢拖不到一半松手_吸附到关() = assertEquals(0f, drag(true, 60f, 20))

    @Test
    fun 拖一半停住再松手_不停在中间() {
        val f = drag(true, 150f, 30)
        assertTrue(f == 0f || f == 1f, "停在了 $f")
    }

    @Test
    fun 子页里划不出() = assertEquals(0f, drag(false, 260f, 10))

    @Test
    fun 待办行截图() = runDesktopComposeUiTest(390, 520) {
        val rows = listOf(
            TodoRow("a", "安卓 UI 与交互统一", null, TodoRow.STATE_DOING, 2, null, 3, issue = 121, ghOpen = true, star = true),
            TodoRow("b", "新外壳接入 App", null, TodoRow.STATE_DONE, 2, null, 2, parent = "a"),
            TodoRow("c", "侧栏手势吸附", null, TodoRow.STATE_OPEN, 1, null, 1, parent = "a", due = NOW + 5 * HOUR_MS),
            TodoRow("d", "插件空间进顶部标签", null, TodoRow.STATE_OPEN, 2, null, 0, parent = "a", repo = "HengXin666/HX-AIOA"),
            TodoRow("e", "续费域名", null, TodoRow.STATE_OPEN, 2, null, 0, due = NOW - 24 * HOUR_MS, alarm = true),
        )
        setContent {
            AioaTheme(Appearance(dark = false)) {
                Column(Modifier.fillMaxWidth().background(Aioa.colors.background)) {
                    todoForest(rows).forEach { n -> Tree(n, emptyList()) }
                }
            }
        }
        onRoot().captureRoboImage("build/outputs/roborazzi/todo_line.png")
    }
}

@androidx.compose.runtime.Composable
private fun Tree(n: TodoTree, lasts: TreePath) {
    val fold = if (n.kids.isNotEmpty()) TodoFold(n.done, n.total, false) {} else null
    TodoLine(n.row, NOW, {}, {}, lasts = lasts, fold = fold, showRepo = true)
    n.kids.forEachIndexed { i, k -> Tree(k, lasts + (i == n.kids.lastIndex)) }
}
