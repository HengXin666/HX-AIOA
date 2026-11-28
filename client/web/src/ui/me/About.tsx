import { useLinkState } from "../../app/hooks";
import { link } from "../../core/link";
import { Group, Row } from "./parts";

const LINK_TEXT = { idle: "未连接", connecting: "连接中", online: "已连接", offline: "重连中" } as const;
const MODE_TEXT = { worker: "多标签共用 (SharedWorker)", leader: "多标签共用 (本标签持有)", follower: "多标签共用 (其他标签持有)", direct: "本页独占" } as const;

export default function About() {
  const state = useLinkState();
  return (
    <>
      <Group title="连接">
        <Row label="状态" value={LINK_TEXT[state]} />
        {link.mode && <Row label="方式" value={MODE_TEXT[link.mode]} />}
      </Group>
      <Group title="关于">
        <Row label="Web 版本" value={`${__WEB_BUILD__.web} (${__WEB_BUILD__.sha})`} />
        <p className="text-xs text-muted-foreground">代理请用系统或浏览器自己的; 链接都从新标签页打开。可从浏览器菜单 "安装" 或 "添加到主屏幕"。</p>
      </Group>
    </>
  );
}

export function Keys() {
  return (
    <Group title="快捷键">
      <Row label="命令面板 (搜会话, 跳页面)" value="Ctrl+K" />
      <Row label="上一个 / 下一个会话" value="Alt+↑ / Alt+↓" />
      <Row label="@ 选择: 上下选, Enter / Tab 确定" value="↑ ↓ Enter" />
      <Row label="关闭群资料 / 退出选择" value="Esc" />
      <Row label="消息菜单" value="右键" />
    </Group>
  );
}
