import { Button } from "@hx/ui/ui/button";
import { Card } from "@hx/ui/ui/card";
import { ConfirmDialog } from "@hx/ui/ui/confirm-dialog";
import { CopyField } from "@hx/ui/ui/copy-field";
import { Skeleton } from "@hx/ui/ui/skeleton";
import { Switch } from "@hx/ui/ui/switch";
import type { PluginInstalled } from "@hx-aioa/protocol";
import {
  ArrowLeft,
  MessageCircle,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Trash2,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { nav } from "../../../app/router";
import * as plugins from "../../../core/plugins";
import { Md } from "../../agent/gui/Md";
import { errText, Group } from "../parts";
import { GhAuth } from "./GhAuth";
import { FitBadge, PluginIcon } from "./parts";

const GH_ID = "hengxin666.gh";
const TASK_PREVIEW_LINES = 6;

// 插件详情 (对照安卓 PluginDetailPage): 管理员放行, 启用开关或安装, 安装后的接入语 (只显示一次), 已安装管理, 任务提示词, 介绍
export function Detail({
  id,
  onBack,
  onChanged,
}: {
  id: string;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [d, setD] = useState<plugins.Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 接入语含密钥, 只放内存, 离开页面就没了
  const [handoff, setHandoff] = useState<PluginInstalled | null>(null);
  const [risky, setRisky] = useState<"allow" | "enable" | null>(null);
  const [rev, bump] = plugins.usePluginRev();
  useEffect(() => {
    plugins.detail(id).then(
      (x) => (setD(x), setError(null)),
      (e) => setError(errText(e)),
    );
  }, [id, rev]);
  const perform = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      onChanged();
      bump();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const head = (
    <Button size="sm" variant="ghost" className="self-start" onClick={onBack}>
      <ArrowLeft />
      插件
    </Button>
  );
  if (!d)
    return (
      <>
        {head}
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : (
          <Skeleton className="h-48 w-full rounded-xl" />
        )}
      </>
    );

  const e = d.manifest;
  const allowed = d.allowed;
  const installed = d.installed;
  const agentless = !(e as { agent?: unknown }).agent;
  const owner = d.owner !== false;
  const item = { ...e, installed, allowed } as plugins.PluginItem;
  const ver = plugins.outdated(item)
    ? `已装 v${installed?.version}, 已放行 v${allowed?.version}`
    : allowed
      ? `v${allowed.version}`
      : `v${e.version}, 待放行`;
  const enable = (on: boolean) =>
    on && d.risky.length
      ? setRisky("enable")
      : void perform(() => plugins.setEnabled(id, on));
  const allowAct = () =>
    d.risky.length
      ? setRisky("allow")
      : void perform(() => plugins.allow(id, d.digest));

  return (
    <>
      {head}
      <div className="flex items-center gap-3 px-1">
        <PluginIcon name={e.icon || "puzzle"} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold">{e.name}</h2>
          <p className="text-xs text-muted-foreground">
            {[ver, e.author].filter(Boolean).join(", ")}
          </p>
        </div>
        <FitBadge
          fit={(d as { client?: plugins.PluginItem["client"] }).client}
        />
      </div>
      {e.summary && <p className="px-1 text-sm">{e.summary}</p>}
      {d.source && (
        <Note>
          来自第三方市场源 {d.source}, 内容由源的作者维护,
          放行前看清它要的权限。
        </Note>
      )}
      {d.gone && (
        <Note>
          市场里已经没有这个插件, 这里是放行时存下的版本, 可以撤销或卸载。
        </Note>
      )}
      {error && <p className="px-1 text-sm text-destructive">{error}</p>}
      {handoff && (
        <Group title="接入群 Agent">
          <p className="text-xs text-muted-foreground">
            整段发给 Claude Code, Codex 等 agent harness 或云 Agent 都行,
            间隔和任务可以先改再发。里面有密钥, 只显示这一次。
          </p>
          <CopyField
            label="接入语"
            value={handoff.prompt}
            multiline
            maxHeight={220}
          />
          <CopyField label="密钥" value={handoff.key} masked maskPeek={4} />
        </Group>
      )}
      {allowed?.dev && d.admin ? (
        <Group title={d.foreign ? "别人开发中" : "开发中"}>
          <p className="text-xs text-muted-foreground">
            {d.foreign
              ? "别的管理员在开发模式下装的本地插件, 只有开发者能用。"
              : "开发模式装的本地插件, 只有你看得到。重新上传即换版本。"}
          </p>
          <Act
            icon={<Trash2 />}
            danger
            disabled={busy}
            onClick={() =>
              void perform(() =>
                d.foreign ? plugins.revoke(id) : plugins.devRemove(id),
              ).then(onBack)
            }
          >
            撤掉
          </Act>
        </Group>
      ) : (
        d.admin && (
          <Group title="管理员">
            <p className="text-xs text-muted-foreground">
              {allowed?.risky?.length
                ? `含高危权限: ${allowed.risky.join(", ")}。`
                : "放行后所有账号都能自己启用; 白名单里每个插件只有一个版本。"}
            </p>
            <div className="flex flex-wrap gap-2">
              {plugins.pending(item) && (
                <Act icon={<ShieldCheck />} disabled={busy} onClick={allowAct}>
                  {allowed ? `放行新版 v${e.version}` : `放行 v${e.version}`}
                </Act>
              )}
              {allowed && (
                <ConfirmDialog
                  trigger={
                    <Button size="sm" variant="outline" disabled={busy}>
                      <ShieldOff />
                      撤销放行
                    </Button>
                  }
                  title={`撤销放行 ${e.name}?`}
                  description="所有账号一起停用, 已装的一并卸掉, 数据保留。"
                  tone="destructive"
                  confirmLabel="撤销"
                  onConfirm={() => perform(() => plugins.revoke(id))}
                />
              )}
            </div>
          </Group>
        )
      )}
      {d.foreign ? (
        <Note>这是别人的开发插件, 只能撤掉, 不能启用或安装。</Note>
      ) : !installed && !allowed ? (
        !d.admin && <Note>管理员还没放行这个插件, 放行后才能启用。</Note>
      ) : agentless || !owner ? (
        <Group title="启用">
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>
              在我的账号启用
              <span className="block text-xs text-muted-foreground">
                停用时数据保留, 再启用即恢复。
              </span>
            </span>
            <Switch
              checked={d.enabled}
              disabled={busy}
              onCheckedChange={enable}
            />
          </label>
        </Group>
      ) : !installed ? (
        <Group title="安装">
          <p className="text-xs text-muted-foreground">
            安装会建群, 发 Agent 密钥, 下发工作台。
            {(e as { agent?: { schedule?: string } }).agent?.schedule
              ? ` 建议的定时: ${(e as { agent?: { schedule?: string } }).agent?.schedule}。`
              : ""}
          </p>
          <Button
            className="self-start"
            disabled={busy}
            onClick={() =>
              void perform(async () => setHandoff(await plugins.install(id)))
            }
          >
            {busy ? "安装中" : "安装"}
          </Button>
        </Group>
      ) : (
        <Group title="已安装">
          {installed.channel && (
            <p className="text-xs text-muted-foreground">
              群: {installed.channel}
            </p>
          )}
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>
              自动更新
              <span className="block text-xs text-muted-foreground">
                管理员放行新版后自动换上。群, 密钥, 待办都不变。
              </span>
            </span>
            <Switch
              checked={installed.auto !== false}
              onCheckedChange={(on) =>
                void perform(() => plugins.setAuto(id, on))
              }
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Act
              icon={<RefreshCw />}
              disabled={busy}
              onClick={() => void perform(() => plugins.update(id))}
            >
              {plugins.outdated(item)
                ? `更新到 v${allowed?.version}`
                : "重新应用放行的版本"}
            </Act>
            {installed.channel && (
              <Act
                icon={<MessageCircle />}
                onClick={() => nav("chat", installed.channel)}
              >
                打开群
              </Act>
            )}
            <ConfirmDialog
              trigger={
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  className="text-destructive"
                >
                  <Trash2 />
                  卸载
                </Button>
              }
              title={`卸载 ${e.name}?`}
              description="会作废它的 Agent 密钥并移除工作台面板。群里的消息和待办保留, 重新安装能接上。"
              tone="destructive"
              confirmLabel="卸载"
              onConfirm={() =>
                perform(() =>
                  plugins.uninstall(id).then(() => setHandoff(null)),
                )
              }
            />
          </div>
        </Group>
      )}
      {id === GH_ID && d.enabled && <GhAuth />}
      {d.task && <Task task={d.task} installed={Boolean(installed)} />}
      <Card className="p-4">
        {d.readmeType === "html" ? (
          <iframe
            title={`${e.name} 介绍`}
            sandbox=""
            srcDoc={d.readme}
            className="h-[60vh] w-full rounded-md bg-white"
          />
        ) : (
          <Md text={d.readme} />
        )}
      </Card>
      {risky && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setRisky(null)}
          title={`${risky === "allow" ? "放行" : "启用"} ${e.name}?`}
          description={`它要这些高危权限: ${d.risky.join(", ")}。确认你信任它。`}
          tone="destructive"
          confirmLabel={risky === "allow" ? "放行" : "启用"}
          onConfirm={() =>
            perform(() =>
              risky === "allow"
                ? plugins.allow(id, d.digest)
                : plugins.setEnabled(id, true),
            ).then(() => setRisky(null))
          }
        />
      )}
    </>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      {children}
    </p>
  );
}

function Act({
  icon,
  children,
  onClick,
  disabled,
  danger,
}: {
  icon: ReactNode;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={disabled}
      onClick={onClick}
      className={`self-start ${danger ? "text-destructive" : ""}`}
    >
      {icon}
      {children}
    </Button>
  );
}

// 任务提示词: 插件让 Agent 干什么, 不含密钥, 可以单独复制给任何 Agent
function Task({ task, installed }: { task: string; installed: boolean }) {
  const [open, setOpen] = useState(false);
  const shown = open
    ? task
    : `${task.split("\n").slice(0, TASK_PREVIEW_LINES).join("\n")}\n...`;
  return (
    <Group title="任务提示词">
      <p className="text-xs text-muted-foreground">
        {installed
          ? "这个插件让 Agent 干的活, 不含密钥。想换一个 Agent, 复制这段即可; 接入本身仍用接入语。"
          : "装好后 Agent 会照这段干活, 不含密钥。"}
      </p>
      <CopyField
        value={shown}
        copyValue={task}
        multiline
        maxHeight={open ? 420 : 160}
      />
      <Button
        size="xs"
        variant="ghost"
        className="self-start"
        onClick={() => setOpen(!open)}
      >
        {open ? "收起" : "展开全文"}
      </Button>
    </Group>
  );
}
