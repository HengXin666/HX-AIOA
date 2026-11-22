package com.hengxin.aioa.kit

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.runDesktopComposeUiTest
import androidx.compose.ui.unit.dp
import com.github.takahirom.roborazzi.ExperimentalRoborazziApi
import io.github.takahirom.roborazzi.captureRoboImage
import kotlin.test.Test
import kotlin.test.assertEquals

private const val NAS = "nas-01"
private const val CPU = "cpu"
private const val MEM = "mem"
private const val UP = "up"
private const val AGENT = "dsh"
private const val P_HEALTH = "health"
private const val P_NAS = "nas"
private const val P_FEED = "feed"
private const val AGENT_PANEL = "agent"
private const val NOW = 1_700_000_000_000L
private const val STEP_MS = 60_000L

private val CPU_BIND = SpaceBind(NAS, CPU, source = "beszel", range = "10m")

// 覆盖全部组件类型的工作台, 与 Web 的 mock 同构
private val SPACE = Space(
    id = "servers",
    title = "服务器",
    panels = listOf(
        SpacePanel(
            P_NAS, "群晖 NAS", "hard-drive", PanelSize.M,
            items = listOf(
                SpaceItem("ring", ItemType.RING, "CPU", question = "NAS 现在忙不忙?", binds = listOf(SpaceBind(NAS, CPU)), props = mapOf("warn" to 70, "crit" to 90)),
                SpaceItem(MEM, ItemType.VALUE, "内存", binds = listOf(SpaceBind(NAS, MEM, range = "10m"))),
                SpaceItem("spark", ItemType.SPARKLINE, "温度", question = "在变热吗?", binds = listOf(SpaceBind(NAS, "temp"))),
                SpaceItem("line", ItemType.LINE, "CPU 走势", question = "最近 10 分钟有没有尖峰?", binds = listOf(CPU_BIND)),
            ),
        ),
        SpacePanel(
            P_HEALTH, "在线状态", "wifi", PanelSize.S, everySec = 60,
            items = listOf(SpaceItem("grid", ItemType.STATUS_GRID, binds = listOf(SpaceBind(NAS, UP), SpaceBind("vps-1", UP)), props = mapOf("labels" to listOf("NAS", "VPS")))),
        ),
        SpacePanel(P_FEED, "动态", "bell", PanelSize.L, items = listOf(SpaceItem("list", ItemType.LIST, binds = listOf(SpaceBind(NAS, "events"))))),
        SpacePanel(
            AGENT_PANEL, "Agent", "bot", PanelSize.Full,
            items = listOf(
                SpaceItem("approve", ItemType.APPROVAL, binds = listOf(SpaceBind(AGENT, "task"))),
                SpaceItem("chat", ItemType.CHAT, props = mapOf("agent" to AGENT)),
                SpaceItem("tasks", ItemType.TASK_CARD, props = mapOf("limit" to 1)),
                SpaceItem("daily", ItemType.REPORT, binds = listOf(SpaceBind(ANY_SUBJECT, "report"))),
                SpaceItem("restart", ItemType.BUTTON, "重启容器", action = SpaceAction(AGENT, "restart", danger = true)),
            ),
        ),
    ),
    layout = SpaceLayout(order = listOf(P_HEALTH, P_NAS), sizes = mapOf(P_FEED to PanelSize.Full)),
)

private val TASK = TaskCardData(
    id = "deploy-42", agent = AGENT, title = "部署到生产", phase = TaskPhase.Waiting, updated = "1 分钟前",
    question = "切换生产流量?", options = listOf(TaskOption("go", "切换", ButtonStyle.Danger), TaskOption("hold", "先不")), danger = true,
)

private object FakeSource : SpaceSource {
    override val ready = true
    override val error: String? = null
    override val now = NOW
    private val wave = listOf(22f, 35f, 31f, 64f, 48f, 52f, 41f, 75f, 58f, 62f)
    override fun samples(bind: SpaceBind): List<MetricSample> = when (bind.field) {
        CPU, "temp" -> wave.mapIndexed { i, v -> MetricSample(NOW - (wave.size - 1 - i) * STEP_MS, v) }
        MEM -> listOf(MetricSample(NOW - STEP_MS, 38f), MetricSample(NOW, 41f))
        UP -> listOf(MetricSample(NOW, if (bind.subject == NAS) 1f else 0f))
        else -> emptyList()
    }
    override fun unit(bind: SpaceBind) = METRIC_UNITS[bind.field].orEmpty()
    override fun events(subject: String) = listOf(FeedItem("e1", "alert-triangle", "磁盘 sda 出现坏道", "SMART 重分配扇区 12 个", "Beszel", "4 分钟前", Tone.Critical))
    override fun report(subject: String) = ReportView("今日 AI 日报", "50 条动态归纳为 5 条, NAS 温度稳定。", "DSH 日报 · 2 小时前")
    override fun tasks() = listOf(TASK)
    override fun chat(taskId: String) = listOf(ChatLine(ChatRole.User, "把 v0.8.3 部署到生产"), ChatLine(ChatRole.Agent, "健康检查通过, 等你确认切流量。"))
    override fun clock(ts: Long) = "${(ts - NOW) / STEP_MS}m"
}

private object NoopHandler : SpaceHandler {
    override fun press(space: Space, item: SpaceItem) = Unit
    override fun option(task: TaskCardData, option: TaskOption) = Unit
    override fun ask(taskId: String, text: String) = Unit
    override fun layout(space: Space, change: LayoutChange) = Unit
}

/** 工作台渲染: 手机与平板宽度各一张, 编辑模式一张。 */
@OptIn(ExperimentalTestApi::class, ExperimentalRoborazziApi::class)
class SpaceScreenshotTest {

    private fun shot(name: String, width: Int, editing: Boolean) = runDesktopComposeUiTest(width, 1800) {
        setContent {
            AioaTheme(Appearance(dark = false)) {
                Adaptive {
                    Column(
                        Modifier.fillMaxSize().background(Aioa.colors.background).verticalScroll(rememberScrollState()).padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) { SpaceBoard(listOf(SPACE, SPACE.copy(id = "home", title = "家庭")), SPACE.id, editing, FakeSource, NoopHandler, {}, {}) }
                }
            }
        }
        onRoot().captureRoboImage("build/outputs/roborazzi/$name.png")
    }

    @Test
    fun phone() = shot("space_phone", 390, editing = false)

    @Test
    fun tablet() = shot("space_tablet", 1000, editing = false)

    @Test
    fun editing() = shot("space_editing", 390, editing = true)

    @Test
    fun layoutRules() {
        assertEquals(listOf(P_HEALTH, P_NAS, P_FEED, AGENT_PANEL), SPACE.orderedPanels().map { it.id })
        assertEquals(PanelSize.Full, SPACE.sizeOf(SPACE.panels[2]))
        assertEquals(PanelSize.Full, PanelSize.L.step(1))
        assertEquals(PanelSize.S, PanelSize.S.step(-1))
        val moved = SPACE.layout.apply(LayoutChange.Size(P_NAS, PanelSize.S))
        assertEquals(PanelSize.S, moved.sizes[P_NAS])
        assertEquals(11, CATEGORY_OF.size)
    }
}
