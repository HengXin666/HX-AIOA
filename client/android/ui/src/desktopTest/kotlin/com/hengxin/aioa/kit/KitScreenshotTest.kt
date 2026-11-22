package com.hengxin.aioa.kit

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.runDesktopComposeUiTest
import androidx.compose.ui.unit.dp
import com.github.takahirom.roborazzi.ExperimentalRoborazziApi
import io.github.takahirom.roborazzi.captureRoboImage
import kotlin.test.Test

private const val WIDTH = 390
private const val HEIGHT = 720
private const val OUT_DIR = "build/outputs/roborazzi"

private val WAITING = TaskCardData(
    id = "deploy-42", agent = "DSH", title = "部署到生产", phase = TaskPhase.Waiting, updated = "1 分钟前",
    summary = "镜像已推送, 健康检查通过", question = "切换生产流量?",
    options = listOf(TaskOption("go", "切换", ButtonStyle.Danger), TaskOption("hold", "先不")), danger = true,
)
private val FEED = listOf(
    FeedItem("e1", "alert-triangle", "磁盘 sda 故障", "SMART 报告 12 个重映射扇区", "群晖 NAS", "2 分钟前", Tone.Critical),
    FeedItem("e2", "server", "vps-1 掉线", "容器离线 3 个", "探针", "8 分钟前", Tone.Warning, count = 4),
)

/** 每个组件明暗各一张; 录制: recordRoborazziDesktop, 对比: compareRoborazziDesktop, 校验: verifyRoborazziDesktop。 */
@OptIn(ExperimentalTestApi::class, ExperimentalRoborazziApi::class)
class KitScreenshotTest {

    private fun shot(name: String, content: @Composable () -> Unit) {
        for (dark in listOf(false, true)) {
            runDesktopComposeUiTest(WIDTH, HEIGHT) {
                setContent {
                    AioaTheme(Appearance(dark = dark)) {
                        Column(
                            Modifier.fillMaxSize().background(Aioa.colors.background).padding(16.dp),
                            verticalArrangement = Arrangement.spacedBy(12.dp),
                        ) { content() }
                    }
                }
                onRoot().captureRoboImage("$OUT_DIR/$name-${if (dark) "dark" else "light"}.png")
            }
        }
    }

    @Test
    fun statCard() = shot("stat_card") {
        StatCard("cpu", "CPU", 23.5f, "%", trend = listOf(20f, 24f, 22f, 26f, 23.5f), delta = "nas-01", source = "探针")
        StatCard("thermometer", "温度", 58f, "°C", state = CardState.Stale("10 分钟前"))
    }

    @Test
    fun states() = shot("states") {
        StatCard("cpu", "加载中", 0f, "%", state = CardState.Loading)
        StatCard("server", "空", 0f, "", state = CardState.Empty)
        StatCard("wifi-off", "错误", 0f, "", state = CardState.Error("GPU-01 无法连接"))
    }

    @Test
    fun layerSection() = shot("layer_section") {
        LayerSection("需要我", "少而重要", FEED, CardState.Ready, "")
        LayerSection("值得一看", "空", emptyList(), CardState.Ready, "今天没有新内容")
        LayerSection("正在发生", "错误", emptyList(), CardState.Error("未连接服务端"), "", onRetry = {})
    }

    @Test
    fun taskCard() = shot("task_card") {
        TaskCard(WAITING, onOption = {})
        TaskCard(WAITING.copy(id = "b", phase = TaskPhase.Running, progress = 0.4f, step = "上传快照", question = null))
        TaskCard(WAITING.copy(id = "c", phase = TaskPhase.Failed, result = "健康检查失败", question = null))
    }

    @Test
    fun releaseNotes() = shot("release_notes") {
        Card { ReleaseNotesView("0.1.42", listOf("安卓: 代理内核按需启动", "安卓: 自适应心跳", "协议 v1: 事件与任务帧"), onClose = {}) }
    }
}
