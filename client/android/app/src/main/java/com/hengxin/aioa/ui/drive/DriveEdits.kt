package com.hengxin.aioa.ui.drive

// 网盘的乐观更新与预取规则 (#159), 不碰安卓与网络, 单测见 DriveEditsTest

private const val PENDING = "pending:"
/** 打开目录后预取前几个子目录, 同时最多 2 个请求。 */
internal const val PREFETCH_MAX = 4
internal const val PREFETCH_PARALLEL = 2

/** 一次改动: change 先改本地列表给人看, run 发请求; 失败回滚并提示 label。 */
class DriveEdit(val label: String, val change: (List<DriveNode>) -> List<DriveNode>, val run: suspend () -> Unit)

object DriveEdits {
    /** 新建文件夹: 先放一个占位, 刷新后换成服务端的真节点。 */
    fun add(items: List<DriveNode>, name: String, now: Long = System.currentTimeMillis()): List<DriveNode> =
        if (items.any { it.name == name }) items else items + DriveNode(PENDING + name, name, true, 0, "", now)

    fun rename(items: List<DriveNode>, id: String, name: String): List<DriveNode> = items.map { if (it.id == id) it.copy(name = name) else it }

    fun remove(items: List<DriveNode>, id: String): List<DriveNode> = items.filter { it.id != id }

    /** 移动: 目标不是当前目录时从当前列表拿掉。 */
    fun move(items: List<DriveNode>, id: String, here: String, to: String): List<DriveNode> = if (to == here) items else remove(items, id)

    fun pending(n: DriveNode): Boolean = n.id.startsWith(PENDING)

    /** 要预取的子目录路径: 按显示顺序取前 max 个文件夹, 跳过占位。 */
    fun prefetch(dir: String, shown: List<DriveNode>, max: Int = PREFETCH_MAX): List<String> =
        shown.filter { it.dir && !pending(it) }.take(max).map { DrivePaths.join(dir, it.name) }
}
