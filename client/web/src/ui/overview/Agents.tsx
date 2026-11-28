import { triggerView, type ChatAgent, type ChatMeta } from "@hx-aioa/protocol";
import { Badge } from "@hx/ui/ui/badge";
import { Button } from "@hx/ui/ui/button";
import { Card } from "@hx/ui/ui/card";
import { m } from "motion/react";
import { Bot, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { useChats, useFaces } from "../../app/hooks";
import { link, nav } from "../../app/router";
import { chats, titleOf } from "../../core/chats";
import { CLOUD_AGENT_LABEL } from "../../core/constants";
import { faces } from "../../core/faces";
import { UserAvatar } from "../UserAvatar";
import { Ring, Section, TONE, tint } from "./parts";

const SHOWN = 8;
const MINUTE = 60_000;
const TONES = [TONE.primary, TONE.warning, TONE.accent, TONE.success];
const RING_DELAY = 0.3;
const RING_STEP = 0.12;

// 群 Agent (对照安卓 OverviewV2.AgentTile): 环是 "从上次运行到下次触发" 走了多少; 逾期标红, 没上报触发方式时只显示名字
export function Agents({ className }: { className?: string }) {
  useChats();
  useFaces();
  const now = useMinute();
  const list = chats.ordered().flatMap((meta) => (meta.agents ?? []).map((a) => [meta, a] as const));
  if (!list.length) return null;
  return (
    <Section
      title={CLOUD_AGENT_LABEL}
      icon={<Bot />}
      tone="accent"
      count={list.length}
      hint="环是离下次运行走了多少"
      className={className}
      action={
        <Button asChild size="xs" variant="ghost">
          <a href={link("chat")}>
            消息
            <ChevronRight />
          </a>
        </Button>
      }
    >
      {/* 手机上横向滑动 (对照安卓一排 158dp 的块), 宽屏铺满一行 */}
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:overflow-visible sm:px-0 sm:[grid-template-columns:repeat(auto-fit,minmax(190px,1fr))]">
        {list.slice(0, SHOWN).map(([meta, a], i) => (
          <Tile key={a.keyId} meta={meta} a={a} i={i} now={now} />
        ))}
      </div>
    </Section>
  );
}

// 环与 "约 N 分钟后" 每分钟走一次
function useMinute(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), MINUTE);
    return () => clearInterval(id);
  }, []);
  return now;
}

function Tile({ meta, a, i, now }: { meta: ChatMeta; a: ChatAgent; i: number; now: number }) {
  const tone = TONES[i % TONES.length]!;
  const view = a.trigger ? triggerView(a.trigger, a.lastRun, now) : undefined;
  const next = view?.next;
  const last = a.lastRun;
  const f = next && last && next > last ? Math.min(1, Math.max(0, (now - last) / (next - last))) : 0;
  const [text, color] = a.pending
    ? ["等它重新接入", TONE.warning]
    : view?.late
      ? ["超时未运行", TONE.danger]
      : next
        ? [`约 ${Math.max(1, Math.round((next - now) / MINUTE))} 分钟后运行`, tone]
        : ["没上报触发方式", TONE.muted];
  const avatar = faces.sender(a.sourceId)?.avatar;
  return (
    <m.div className="w-[168px] shrink-0 snap-start sm:w-auto" whileHover={{ y: -3 }} whileTap={{ scale: 0.98 }} transition={{ type: "spring", stiffness: 400, damping: 30 }}>
      <Card effect="spotlight" effectColor={tint(tone, 30)} className="h-full cursor-pointer gap-3 p-4" onClick={() => nav("chat", meta.channel)}>
        <div className="flex items-start justify-between">
          <Ring value={f} color={color} delay={RING_DELAY + i * RING_STEP}>
            {avatar ? (
              <UserAvatar id={avatar} name={a.name} />
            ) : (
              <span className="grid size-full place-items-center [&_svg]:size-5" style={{ background: tint(tone, 16), color: tone }}>
                <Bot />
              </span>
            )}
          </Ring>
          {a.plugin && <Badge variant="secondary">插件</Badge>}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{a.name}</p>
          <p className="truncate text-xs text-muted-foreground">{titleOf(meta)}</p>
        </div>
        <p className="text-xs font-medium" style={{ color }}>
          {text}
        </p>
      </Card>
    </m.div>
  );
}
