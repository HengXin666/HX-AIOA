import {
  PATH_GH,
  PATH_GH_AGENT,
  PATH_GH_DEVICE,
  PATH_GH_DEVICE_POLL,
  PATH_GH_REPOS,
  PATH_GH_RULES,
  PATH_GH_TOKEN,
  type GhDevice,
  type GhDevicePoll,
  type GhRepo,
  type GhRules,
  type GhStatus,
} from "@hx-aioa/protocol";
import { Button } from "@hx/ui/ui/button";
import { ConfirmDialog } from "@hx/ui/ui/confirm-dialog";
import { CopyField } from "@hx/ui/ui/copy-field";
import { Input } from "@hx/ui/ui/input";
import { Switch } from "@hx/ui/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@hx/ui/ui/toggle-group";
import { ExternalLink, Monitor, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, fill } from "../../../core/auth";
import { EXTERNAL, LOCALE } from "../../../core/constants";
import { errText, Group, Row } from "../parts";

const SEC = 1000;
const TOKEN_MIN = 20;
const OPS_SHOWN = 8;
const PAT_URL = "https://github.com/settings/personal-access-tokens/new";
const QUICK_DAYS: [string, string][] = [
  ["0", "不按时间"],
  ["365", "近一年"],
  ["90", "近 90 天"],
  ["30", "近 30 天"],
];
const JSON_HEAD = { "content-type": "application/json" };
const put = (path: string, body: unknown) =>
  api<unknown>(path, {
    method: "PUT",
    body: JSON.stringify(body),
    headers: JSON_HEAD,
  });
const time = (ms: number) => new Date(ms).toLocaleString(LOCALE);

// GitHub 授权 (#167, 对照安卓 GhSection): 设备码或令牌; 授权后可收窄仓库范围, 开关能用它的群 Agent。令牌只存在服务端
export function GhAuth() {
  const [st, setSt] = useState<GhStatus | null>(null);
  const [repos, setRepos] = useState<GhRepo[] | null>(null);
  const reload = (fresh = false) =>
    void api<GhStatus>(PATH_GH).then(
      (s) => {
        setSt(s);
        if (s.auth)
          void api<{ repos: GhRepo[] }>(
            `${PATH_GH_REPOS}${fresh ? "?fresh=1" : ""}`,
          ).then(
            (r) => setRepos(r.repos),
            (e) => toast.error(errText(e)),
          );
      },
      (e) => toast.error(errText(e)),
    );
  useEffect(() => reload(), []);
  if (!st) return null;
  if (!st.auth)
    return <Authorize device={st.device} done={() => reload(true)} />;
  const rules = st.rules;
  const setRules = (r: GhRules) => {
    setSt({ ...st, rules: r });
    void put(PATH_GH_RULES, r).then(
      () => reload(),
      (e) => toast.error(errText(e)),
    );
  };
  return (
    <>
      <Group title="GitHub 账号">
        <p className="text-xs text-muted-foreground">
          令牌加密存在你的服务端, 不下发给浏览器和任何 Agent。
        </p>
        <Row label="账号" value={st.auth.login} />
        <Row
          label="方式"
          value={st.auth.kind === "pat" ? "令牌" : "设备码授权"}
        />
        {st.auth.expires && (
          <Row
            label="令牌到期"
            value={`${time(st.auth.expires)}${st.auth.renewable ? " (自动续期)" : " (不能自动续期)"}`}
          />
        )}
        <ConfirmDialog
          trigger={
            <Button
              size="sm"
              variant="outline"
              className="self-start text-destructive"
            >
              <Trash2 />
              撤销授权
            </Button>
          }
          title="撤销 GitHub 授权?"
          description="服务端删掉令牌, 依赖它的插件 Agent 不能再操作 GitHub。"
          tone="destructive"
          confirmLabel="撤销"
          onConfirm={() =>
            api(PATH_GH_TOKEN, { method: "DELETE" }).then(
              () => (setRepos(null), reload()),
            )
          }
        />
      </Group>
      <Group title="仓库范围">
        <p className="text-xs text-muted-foreground">
          GitHub 上授权的仓库是上限, 这里再收窄。手动开关的仓库优先于规则。
        </p>
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={String(rules.pushedDays ?? 0)}
          onValueChange={(v) =>
            v && setRules({ ...rules, pushedDays: Number(v) || undefined })
          }
        >
          {QUICK_DAYS.map(([v, l]) => (
            <ToggleGroupItem key={v} value={v}>
              {l}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Toggle
          label="全部公开仓库"
          on={Boolean(rules.public)}
          set={(on) => setRules({ ...rules, public: on })}
        />
        <Toggle
          label="全部私有仓库"
          on={Boolean(rules.private)}
          set={(on) => setRules({ ...rules, private: on })}
        />
      </Group>
      <Group
        title={`仓库 (放行 ${repos?.filter((r) => r.allowed).length ?? 0} / ${repos?.length ?? 0})`}
      >
        <Button
          size="xs"
          variant="ghost"
          className="self-start"
          onClick={() => reload(true)}
        >
          <RefreshCw />
          刷新列表
        </Button>
        <div className="flex max-h-96 flex-col gap-2 overflow-y-auto">
          {repos?.map((r) => {
            const ok = rules.repos ?? [];
            const deny = rules.deny ?? [];
            const hint = [
              r.private ? "私有" : "公开",
              r.pushed
                ? `最近提交 ${new Date(r.pushed).toLocaleDateString(LOCALE)}`
                : "",
              ok.includes(r.repo)
                ? "手动放行"
                : deny.includes(r.repo)
                  ? "手动排除"
                  : "",
            ]
              .filter(Boolean)
              .join(", ");
            return (
              <Toggle
                key={r.repo}
                label={r.repo}
                hint={hint}
                on={r.allowed}
                set={(on) =>
                  setRules({
                    ...rules,
                    repos: on
                      ? [...ok, r.repo]
                      : ok.filter((x) => x !== r.repo),
                    deny: on
                      ? deny.filter((x) => x !== r.repo)
                      : [...deny, r.repo],
                  })
                }
              />
            );
          })}
        </div>
      </Group>
      {st.agents.length > 0 && (
        <Group title="能用它的群 Agent">
          <p className="text-xs text-muted-foreground">
            声明了依赖的插件 Agent 默认打开, 其他默认关。
          </p>
          {st.agents.map((a) => (
            <Toggle
              key={a.keyId}
              label={a.name}
              hint={`${a.channel}${a.dep ? ", 插件声明了依赖" : ""}`}
              on={a.allowed}
              set={(on) =>
                void put(fill(PATH_GH_AGENT, a.keyId), { allowed: on }).then(
                  () => reload(),
                  (e) => toast.error(errText(e)),
                )
              }
            />
          ))}
        </Group>
      )}
      {st.ops.length > 0 && (
        <Group title="最近操作">
          {st.ops.slice(0, OPS_SHOWN).map((o, i) => (
            <Row
              key={i}
              label={`${o.by} ${o.op} ${o.repo.split("/")[1] ?? o.repo}${o.issue ? `#${o.issue}` : ""}`}
              value={
                <span
                  className={o.ok ? "" : "text-destructive"}
                >{`${time(o.ts)}${o.ok ? "" : " 失败"}`}</span>
              }
            />
          ))}
        </Group>
      )}
    </>
  );
}

function Toggle({
  label,
  hint,
  on,
  set,
}: {
  label: string;
  hint?: string;
  on: boolean;
  set: (on: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className="min-w-0">
        <span className="block truncate">{label}</span>
        {hint && (
          <span className="block truncate text-xs text-muted-foreground">
            {hint}
          </span>
        )}
      </span>
      <Switch checked={on} onCheckedChange={set} />
    </label>
  );
}

// 没授权: 设备码 (在任何登录了 GitHub 的设备上输入) 或粘贴令牌
function Authorize({ device, done }: { device: boolean; done: () => void }) {
  const [dev, setDev] = useState<GhDevice | null>(null);
  const [token, setToken] = useState("");
  useEffect(() => {
    if (!dev) return;
    const t = setInterval(() => {
      void api<GhDevicePoll>(fill(PATH_GH_DEVICE_POLL, dev.id), {
        method: "POST",
      }).then(
        (r) => {
          if (r.status === "pending") return;
          setDev(null);
          if (r.status === "done") done();
          else
            toast.error(
              r.status === "denied"
                ? "你在 GitHub 上拒绝了授权"
                : "码已过期, 重新获取",
            );
        },
        (e) => toast.error(errText(e)),
      );
    }, dev.interval * SEC);
    return () => clearInterval(t);
  }, [dev?.id]);
  return (
    <>
      <Group title="设备码授权">
        <p className="text-xs text-muted-foreground">
          {device
            ? "在任何登录了 GitHub 的设备上打开地址, 输入下面的码。"
            : "服务端没配齐 GH_CLIENT_ID 和 GH_CLIENT_SECRET, 设备码不可用, 先用令牌。"}
        </p>
        {!dev ? (
          <Button
            size="sm"
            variant="outline"
            className="self-start"
            disabled={!device}
            onClick={() =>
              void api<GhDevice>(PATH_GH_DEVICE, { method: "POST" }).then(
                setDev,
                (e) => toast.error(errText(e)),
              )
            }
          >
            <Monitor />
            获取授权码
          </Button>
        ) : (
          <>
            <CopyField label="授权码" value={dev.userCode} />
            <Button asChild size="sm" className="self-start">
              <a href={dev.verifyUrl} {...EXTERNAL}>
                <ExternalLink />
                打开 GitHub 输入
              </a>
            </Button>
            <p className="text-xs text-muted-foreground">
              等你在 GitHub 上点 Authorize, 完成后自动刷新, {time(dev.expires)}{" "}
              前有效。
            </p>
          </>
        )}
      </Group>
      <Group title="粘贴令牌">
        <p className="text-xs text-muted-foreground">
          fine-grained token, 仓库按需选, 权限给 Issues 读写。不能自动续期。
        </p>
        <Input
          type="password"
          placeholder="github_pat_..."
          value={token}
          onChange={(e) => setToken(e.target.value.trim())}
          autoComplete="off"
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={token.length <= TOKEN_MIN}
            onClick={() =>
              void put(PATH_GH_TOKEN, { token }).then(
                () => (setToken(""), done()),
                (e) => toast.error(errText(e)),
              )
            }
          >
            保存令牌
          </Button>
          <Button asChild size="sm" variant="ghost">
            <a href={PAT_URL} {...EXTERNAL}>
              <ExternalLink />去 GitHub 新建令牌
            </a>
          </Button>
        </div>
      </Group>
    </>
  );
}
