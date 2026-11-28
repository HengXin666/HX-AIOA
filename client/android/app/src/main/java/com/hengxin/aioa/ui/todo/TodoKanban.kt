package com.hengxin.aioa.ui.todo

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hengxin.aioa.kit.Aioa
import com.hengxin.aioa.kit.TodoRow

// 看板视图 (#152): 按状态分列, 横向滑动; 列宽占屏宽大半, 露出下一列的边提示还能滑, 平板上几列并排
private const val COL_RATIO = 0.86f
private const val COL_MAX = 340
private const val COL_GAP = 10
private const val SIDE = 14
private const val FAB_ROOM = 88
private val COL_SHAPE = RoundedCornerShape(14.dp)

/** 看板: 每列一种状态, 列里是父子树; 点一行出详情 (改状态, 优先级, 编辑), 勾选即完成。 */
@Composable
internal fun TodoKanban(
    cols: List<TodoColumn>,
    closed: Set<String>,
    toggle: (String) -> Unit,
    showRepo: Boolean,
    open: (TodoRow) -> Unit,
    tick: (TodoRow) -> Unit,
) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val w = minOf(maxWidth * COL_RATIO, COL_MAX.dp)
        LazyRow(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = SIDE.dp),
            horizontalArrangement = Arrangement.spacedBy(COL_GAP.dp),
        ) {
            items(cols, key = { it.state }) { col -> KanbanColumn(col, Modifier.width(w).fillMaxHeight(), closed, toggle, showRepo, open, tick) }
        }
    }
}

@Composable
private fun KanbanColumn(
    col: TodoColumn,
    modifier: Modifier,
    closed: Set<String>,
    toggle: (String) -> Unit,
    showRepo: Boolean,
    open: (TodoRow) -> Unit,
    tick: (TodoRow) -> Unit,
) {
    val c = Aioa.colors
    Column(modifier.padding(top = 4.dp, bottom = 12.dp).clip(COL_SHAPE).background(c.surface)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(9.dp).clip(RoundedCornerShape(2.dp)).background(columnTint(col.state)))
            Text(stateLabel(col.state), Modifier.padding(start = 8.dp).weight(1f), color = c.text, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
            Text("${col.count}", color = c.textSecondary, fontSize = 12.sp)
        }
        if (col.nodes.isEmpty()) Text("没有${stateLabel(col.state)}的待办", Modifier.padding(horizontal = 12.dp, vertical = 8.dp), color = c.textSecondary, fontSize = 12.sp)
        LazyColumn(Modifier.fillMaxWidth().weight(1f), contentPadding = PaddingValues(bottom = FAB_ROOM.dp)) {
            items(col.nodes, key = { "${col.state}|${it.row.uid()}" }) { n ->
                NodeRows(n, 0, closed, toggle, open, showRepo = showRepo, showArea = true, tick = tick)
            }
        }
    }
}

@Composable
private fun columnTint(state: String): Color = when (state) {
    TodoRow.STATE_DONE -> Aioa.colors.success
    else -> stateColor(state) ?: Aioa.colors.textSecondary
}
