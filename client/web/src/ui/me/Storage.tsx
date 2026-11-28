import { FILE_THRESHOLD_MIN, PATH_FILES, PATH_FILES_MIGRATE, PATH_SETTINGS, SETTING_STORAGE, type FileStoreKind, type FileUsage, type MigrateJob, type StorageSettings } from "@hx-aioa/protocol";
import { Button } from "@hx/ui/ui/button";
import { ConfirmDialog } from "@hx/ui/ui/confirm-dialog";
import { Progress } from "@hx/ui/ui/progress";
import { ToggleGroup, ToggleGroupItem } from "@hx/ui/ui/toggle-group";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../../core/auth";
import { clearCache } from "../../core/cache";
import { TXT_LOADING } from "../../core/constants";
import { sizeText } from "../MessageParts";
import { errText, Group, Row } from "./parts";

const STORE: Record<FileStoreKind, string> = { r2: "R2", cfd: "Drive" };
const MB = 1024 * 1024;
const PRESETS_MB = [5, 20, 50, 95];
type Mode = "cfd" | "split" | "r2";
const modeOf = (s: StorageSettings): Mode => (s.small === "cfd" && s.large === "cfd" ? "cfd" : s.small === "r2" && s.large === "r2" ? "r2" : "split");

// 存储 (对照安卓 me-storage): 主人看 R2 / Drive 用量, 选路由, 迁移; 所有人可清本机缓存
export default function Storage({ owner }: { owner: boolean }) {
  return (
    <>
      {owner && <Usage />}
      <Group title="本机缓存">
        <p className="text-xs text-muted-foreground">会话列表与最近消息缓存在浏览器里, 清掉后重新从服务端拉。</p>
        <Button size="sm" variant="outline" onClick={() => void clearCache().then(() => toast.success("已清理, 刷新后生效"))}>
          清理本机缓存
        </Button>
      </Group>
    </>
  );
}

function Usage() {
  const [u, setU] = useState<FileUsage | null>(null);
  const [job, setJob] = useState<MigrateJob | null>(null);
  const reload = () => {
    void api<FileUsage>(PATH_FILES).then(setU, (e) => toast.error(errText(e)));
    void api<{ job: MigrateJob | null }>(PATH_FILES_MIGRATE).then((r) => setJob(r.job), () => undefined);
  };
  useEffect(reload, []);
  if (!u) return <p className="text-sm text-muted-foreground">{TXT_LOADING}</p>;
  const s = u.storage;
  const save = (next: Partial<StorageSettings>) =>
    void api(PATH_SETTINGS, { method: "PATCH", body: JSON.stringify({ [SETTING_STORAGE]: { ...s, ...next } }) }).then(reload, (e) => toast.error(errText(e)));
  const setMode = (m: Mode) => save(m === "cfd" ? { small: "cfd", large: "cfd" } : m === "r2" ? { small: "r2", large: "r2" } : { small: "r2", large: "cfd" });
  const running = job && !job.finished;
  return (
    <>
      <Group title="用量">
        <Row label="R2" value={`${sizeText(u.byStore.r2.bytes)} · ${u.byStore.r2.count} 个${u.limit ? ` / 上限 ${sizeText(u.limit)}` : ""}`} />
        {u.limit > 0 && <Progress value={(u.byStore.r2.bytes / u.limit) * 100} />}
        <Row label="Drive" value={u.ready.cfd ? `${sizeText(u.byStore.cfd.bytes)} · ${u.byStore.cfd.count} 个` : "没有绑定"} />
      </Group>
      <Group title="存储路由 (只影响之后上传的文件)">
        <ToggleGroup type="single" variant="outline" value={modeOf(s)} onValueChange={(v) => v && setMode(v as Mode)}>
          <ToggleGroupItem value="cfd" disabled={!u.ready.cfd}>
            全部 Drive
          </ToggleGroupItem>
          <ToggleGroupItem value="split" disabled={!u.ready.cfd}>
            按大小分
          </ToggleGroupItem>
          <ToggleGroupItem value="r2">全部 R2</ToggleGroupItem>
        </ToggleGroup>
        {modeOf(s) === "split" && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            超过
            {PRESETS_MB.map((n) => (
              <Button key={n} size="xs" variant={s.threshold === n * MB ? "secondary" : "ghost"} disabled={n * MB < FILE_THRESHOLD_MIN} onClick={() => save({ threshold: n * MB })}>
                {n} MB
              </Button>
            ))}
            走 {STORE[s.large === "off" ? "r2" : s.large]}
          </div>
        )}
      </Group>
      <Group title="迁移已有文件">
        {job && (
          <p className="text-sm text-foreground">
            {running ? "正在" : "上次"}搬到 {STORE[job.to]}: 已搬 {job.moved} 个 ({sizeText(job.bytes)}), 失败 {job.failed}, 跳过 {job.skipped}
            {running ? `, 剩 ${job.left}` : ""}
            {job.error ? ` · ${job.error}` : ""}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {running ? (
            <Button size="sm" variant="outline" onClick={() => void api(PATH_FILES_MIGRATE, { method: "DELETE" }).then(reload)}>
              停止
            </Button>
          ) : (
            (["cfd", "r2"] as const).map((to) => (
              <ConfirmDialog
                key={to}
                trigger={
                  <Button size="sm" variant="outline" disabled={!u.ready[to]}>
                    全部搬到 {STORE[to]}
                  </Button>
                }
                title={`把已有文件搬到 ${STORE[to]}?`}
                description="文件 id 不变, 消息不用改; 分批在后台跑, 可以随时停止。"
                confirmLabel="开始"
                onConfirm={() => api(PATH_FILES_MIGRATE, { method: "POST", body: JSON.stringify({ to }) }).then(reload)}
              />
            ))
          )}
          <Button size="sm" variant="ghost" onClick={reload}>
            刷新
          </Button>
        </div>
      </Group>
    </>
  );
}
