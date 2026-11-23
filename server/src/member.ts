import type { KeyInfo, UserPublic } from "@hx-aioa/protocol";

const MEMBER_KEY_PREFIX = "member:";
const MEMBER_RATE_PER_MIN = 600;

// 子号的虚拟 key: 没有 scope, 也不在 registry 里, 只用于限流与区分身份
export function memberKey(user: UserPublic): KeyInfo {
  return { id: MEMBER_KEY_PREFIX + user.id, userId: user.id, name: user.display || user.name, prefix: "", scopes: [], channels: [], ratePerMin: MEMBER_RATE_PER_MIN, created: user.created };
}
