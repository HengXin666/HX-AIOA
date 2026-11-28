import Settings from "../Settings";
import type { AreaProps } from "../Shell";

// 我的栏: 账号, 常用, 数据, 连接, 管理, 系统 (对照 docs/client/android/settings-map.md)
export default function MeArea(_: AreaProps) {
  return (
    <div className="w-full">
      <Settings />
    </div>
  );
}
