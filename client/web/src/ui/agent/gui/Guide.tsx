import type { HostCard } from "@hx-aioa/protocol";
import { Alert, AlertDescription, AlertTitle } from "@hx/ui/ui/alert";
import { Badge } from "@hx/ui/ui/badge";
import { Button } from "@hx/ui/ui/button";
import { Card } from "@hx/ui/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@hx/ui/ui/select";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useAgHub, useConn, usePairs } from "../../../agentgui/hooks";
import { allPairs } from "../../../agentgui/pairs";
import type { AgentDenied } from "../../../agentgui/types";
import { useResources } from "../../../app/hooks";
import { BP_MID } from "../../../core/constants";
import { addProbeScope, SCOPE_AGENT } from "../../../core/probes";
import { AddHostDialog, agentDenied, CommandBox, ScopeFix } from "../../resources/ProbeDialogs";
import { GUIDE, guiLink, INBOX, SETTINGS } from "./parts";
import { PairSection } from "./Settings";

// 上手指引 (#126): 按状态判断卡在哪一步。新会话页的空状态只显示当前一步, #/agent/gui/guide 显示全部
export type GuideStep = "install" | "enable" | "scope" | "pair" | "route" | "login";

const UA = "hx-aioa-agent/1";
// 已装主机开启 Agent: install.sh 不带 --key 时沿用已装的 env
export const enableCommand = (sudo = false): string => `curl -fsSL -A ${UA} ${location.origin}/install.sh | ${sudo ? "sudo " : ""}sh -s -- --agent`;
const LOGINS: { name: string; cmd: string; note: string }[] = [
  { name: "Claude Code", cmd: "claude", note: "进去后输入 /login" },
  { name: "Codex", cmd: "codex login", note: "" },
  { name: "DSH", cmd: "dsh", note: "先在终端里能正常对话 (登录或配好 key)" },
];

const agentOn = (h: HostCard): boolean => Boolean(h.info.agent) && (h.info.agent as AgentDenied).denied !== "scope";

export type GuideState = { step: GuideStep | null; host: string; agentHosts: string[]; plainHosts: string[] };

export function useGuide(host: string): GuideState {
  usePairs();
  const hub = useAgHub();
  const { probes, hosts } = useResources();
  const c = useConn(host);
  const agentHosts = [...new Set([...hosts.filter(agentOn).map((h) => h.subject), ...hub.hosts.map((h) => h.subject)])].sort();
  const denied = hosts.filter((h) => agentDenied(h)).map((h) => h.subject);
  const plainHosts = [...new Set([...probes, ...hosts.map((h) => h.subject)])].filter((h) => !agentHosts.includes(h) && !denied.includes(h)).sort();
  const pairs = allPairs();
  const base = { agentHosts, plainHosts };
  if (host && denied.includes(host)) return { ...base, step: "scope", host };
  if (!pairs.length) {
    if (agentHosts.length) return { ...base, step: "pair", host: agentHosts.includes(host) ? host : agentHosts[0]! };
    if (denied.length) return { ...base, step: "scope", host: denied[0]! };
    return { ...base, step: plainHosts.length ? "enable" : "install", host: "" };
  }
  if (c.state === "unpaired" || c.state === "auth" || c.state === "changed") return { ...base, step: "pair", host };
  if (c.state === "noroute" || c.state === "unreachable") return { ...base, step: "route", host };
  if (c.login && !c.login.sid) return { ...base, step: "login", host };
  return { ...base, step: null, host };
}

function Cmd({ children }: { children: ReactNode }) {
  return <code className="rounded bg-muted px-1 font-mono text-xs text-foreground">{children}</code>;
}

function Prereq() {
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
      <li>
        那台电脑装好 Node.js 22+ (<Cmd>node -v</Cmd>)
      </li>
      <li>至少一个能在终端里正常用的 Agent: Claude Code, Codex 或 DSH (已登录)</li>
      <li>适配器不用装, 第一次开会话时 npx 自动下载</li>
    </ul>
  );
}

function Install() {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">在要跑 Agent 的电脑上装探针并开启 Agent。探针就是本地后端, 不用另起服务。</p>
      <Prereq />
      <Button className="self-start" onClick={() => setOpen(true)}>
        添加主机
      </Button>
      <p className="text-xs text-muted-foreground">生成的命令默认带 --agent, 复制到那台电脑的终端运行。</p>
      <AddHostDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

function Enable({ hosts }: { hosts: string[] }) {
  const [subject, setSubject] = useState(hosts[0] ?? "");
  const [busy, setBusy] = useState(false);
  const [granted, setGranted] = useState("");
  const grant = async () => {
    if (!subject) return;
    setBusy(true);
    try {
      const r = await addProbeScope(subject, [SCOPE_AGENT]);
      if (!r.ok) throw new Error("没有补上");
      setGranted(subject);
      toast.success(`${subject} 的 key 已带 probe:agent`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">已经装了探针, 但还没开启 Agent。两步:</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-foreground">1. 给 key 加权限</span>
        {hosts.length > 1 && (
          <Select value={subject} onValueChange={setSubject}>
            <SelectTrigger size="sm" className="w-44" aria-label="主机">
              <SelectValue placeholder="选择主机" />
            </SelectTrigger>
            <SelectContent>
              {hosts.map((h) => (
                <SelectItem key={h} value={h}>
                  {h}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button size="sm" variant="outline" onClick={() => void grant()} disabled={busy || !subject}>
          {granted === subject ? "已加上" : busy ? "处理中" : `给 ${subject || "主机"} 加 probe:agent`}
        </Button>
      </div>
      <span className="text-sm text-foreground">2. 在那台电脑上, 用当初安装探针的用户运行 (沿用原来的配置, 不用 key):</span>
      <CommandBox command={enableCommand()} note="以 root 安装的 (/opt/hx-aioa-probe), 把 sh 换成 sudo sh。" copied="命令已复制" />
      <p className="text-xs text-muted-foreground">
        手动做法: 在探针目录的 env 里设 <Cmd>AIOA_AGENT=1</Cmd> 不够, 还要下载 probe-agent*.mjs, 所以请用上面的命令。
      </p>
    </div>
  );
}

function Pair({ host }: { host: string }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">在装了探针的那台电脑上用浏览器打开本页, 用主账号密码配对一次; 之后直连探针, 不经过 Hub。</p>
      <PairSection bare initial={host} />
    </div>
  );
}

function RouteTip({ host }: { host: string }) {
  return (
    <div className="flex flex-col gap-2 text-sm text-muted-foreground">
      <p>
        {host || "这台主机"} 只监听本机 (127.0.0.1:7841), 本期只能在那台电脑上的浏览器里开会话; 局域网直连需要 https 或隧道, 下一期。
      </p>
      <p>其它设备 (包括手机) 先用审批: 在收件箱里答 Agent 的请求。</p>
      <Button size="sm" variant="outline" className="self-start" asChild>
        <a href={guiLink(INBOX)}>去收件箱</a>
      </Button>
    </div>
  );
}

function LoginTip() {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">适配器用的是 Agent 自己的登录。在那台电脑的终端里 (与探针同一用户) 先登录:</p>
      <ul className="space-y-1 text-sm">
        {LOGINS.map((l) => (
          <li key={l.name} className="flex flex-wrap items-center gap-2">
            <span className="w-24 text-foreground">{l.name}</span>
            <Cmd>{l.cmd}</Cmd>
            {l.note && <span className="text-xs text-muted-foreground">{l.note}</span>}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">Agent 公布了登录方式时, 新会话页也会直接给登录按钮。</p>
    </div>
  );
}

const TITLE: Record<GuideStep, string> = {
  install: "装探针并开启 Agent",
  enable: "在已装的主机上开启 Agent",
  scope: "补上 Agent 权限",
  pair: "配对这台设备",
  route: "这台设备不能直连",
  login: "Agent 还没登录",
};

function Body({ g }: { g: GuideState }) {
  switch (g.step) {
    case "install":
      return <Install />;
    case "enable":
      return <Enable hosts={g.plainHosts} />;
    case "scope":
      return (
        <div className="flex flex-col gap-2">
          <ScopeFix subject={g.host} />
          <p className="text-xs text-muted-foreground">key 不变, 探针自动重连后生效, 不用重装。</p>
        </div>
      );
    case "pair":
      return <Pair host={g.host} />;
    case "route":
      return <RouteTip host={g.host} />;
    case "login":
      return <LoginTip />;
    default:
      return null;
  }
}

function MobileNote() {
  if (window.innerWidth >= BP_MID) return null;
  return (
    <Alert variant="info">
      <AlertTitle>手机本期只能审批</AlertTitle>
      <AlertDescription>配对与开会话在电脑上做; 手机在收件箱里答 Agent 的请求。</AlertDescription>
    </Alert>
  );
}

// 新会话页的空状态: 只显示卡住的那一步; 都就绪时不渲染
export function GuideCard({ g }: { g: GuideState }) {
  if (!g.step || g.step === "route" || g.step === "login") return null;
  return (
    <Card className="flex w-full max-w-xl flex-col gap-3 p-4 text-left">
      <div className="flex items-center gap-2">
        <h3 className="flex-1 text-base font-semibold text-foreground">{TITLE[g.step]}</h3>
        <a href={guiLink(GUIDE)} className="text-xs text-muted-foreground hover:text-foreground">
          完整指引
        </a>
      </div>
      <Body g={g} />
      <MobileNote />
    </Card>
  );
}

type Row = { key: string; title: string; done: boolean; body: ReactNode };

// 完整指引: 每一步标完成与否, 没完成的展开
export function GuidePage({ host }: { host: string }) {
  const g = useGuide(host);
  const pre = g.step === "install" || g.step === "enable";
  const rows: Row[] = [
    { key: "pre", title: "准备: Node 与 Agent", done: false, body: <Prereq /> },
    { key: "probe", title: g.step === "enable" ? TITLE.enable : TITLE.install, done: !pre, body: g.step === "enable" ? <Enable hosts={g.plainHosts} /> : <Install /> },
    ...(g.step === "scope" ? [{ key: "scope", title: TITLE.scope, done: false, body: <Body g={g} /> }] : []),
    { key: "pair", title: TITLE.pair, done: !pre && g.step !== "scope" && g.step !== "pair", body: <Pair host={g.host} /> },
    ...(g.step === "route" ? [{ key: "route", title: TITLE.route, done: false, body: <RouteTip host={g.host} /> }] : []),
    { key: "login", title: "Agent 登录", done: false, body: <LoginTip /> },
    { key: "use", title: "开会话与审批", done: false, body: <UseTips /> },
  ];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
        <h2 className="text-xl font-semibold text-foreground">使用指引</h2>
        <MobileNote />
        {g.step === null && (
          <Alert variant="success">
            <AlertTitle>都就绪了</AlertTitle>
            <AlertDescription>
              <a href={guiLink()} className="underline">
                去开新会话
              </a>
            </AlertDescription>
          </Alert>
        )}
        {rows.map((r, i) => (
          <Card key={r.key} className="flex flex-col gap-3 p-4">
            <div className="flex items-center gap-2">
              <h3 className="flex-1 text-base font-semibold text-foreground">
                {i + 1}. {r.title}
              </h3>
              {r.done && <Badge variant="outline" dot="success">已完成</Badge>}
            </div>
            {!r.done && r.body}
          </Card>
        ))}
      </div>
    </div>
  );
}

function UseTips() {
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
      <li>新会话: 选主机, 项目目录与 Agent 实例, 发第一条消息就开始。第一次用某个 Agent 要下载适配器, 可能几分钟。</li>
      <li>权限模式用 Agent 自己公布的 (如默认, 自动改文件, 计划), 在会话输入框旁切, Ctrl+Shift+A 轮换; 新会话也可以先填。</li>
      <li>Agent 要权限时出审批卡: 允许一次, 总是允许, 拒绝, 或拒绝并说明。风险档只决定在哪答, 不替你答。</li>
      <li>
        顶栏 "审批" 切到收件箱; 电脑前看着时手机默认静默推送, 可在 <a href={guiLink(SETTINGS)} className="underline">设置</a> 里改。
      </li>
    </ul>
  );
}
