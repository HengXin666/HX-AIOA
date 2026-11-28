import {
  MAX_AVATAR_BYTES,
  PATH_AVATARS,
  PATH_INVITES,
  PATH_ME,
  PATH_ME_DEVICE,
  PATH_ME_PASSWORD,
  PATH_USER,
  PATH_USER_APPROVE,
  PATH_USERS,
  type InviteCreated,
  type InviteInfo,
  type InviteRequest,
  type Me,
  type MePatch,
  type UserPublic,
} from "@hx-aioa/protocol";
import { accessToken, api, ApiError, fill, setCurrentUser } from "./auth";

const AVATAR_SIZE = 256;
const AVATAR_QUALITY = [0.9, 0.8, 0.7, 0.6, 0.5];

// 账号与成员 (对照安卓 me-account / me-members)
export const loadMe = (): Promise<Me> => api<Me>(PATH_ME);

export async function patchMe(p: MePatch): Promise<void> {
  const r = await api<{ user: UserPublic }>(PATH_ME, { method: "PATCH", body: JSON.stringify(p) });
  if (r?.user) setCurrentUser(r.user);
}

export const changePassword = (old: string, next: string) => api(PATH_ME_PASSWORD, { method: "POST", body: JSON.stringify({ old, new: next }) });
export const dropDevice = (id: string) => api(fill(PATH_ME_DEVICE, id), { method: "DELETE" });

// 头像: 居中裁成正方形, 缩到 256, 转 JPEG 压到服务端上限以内 (服务端不收 SVG)
async function squareJpeg(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = AVATAR_SIZE;
  canvas.getContext("2d")!.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  bmp.close();
  for (const q of AVATAR_QUALITY) {
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", q));
    if (blob && blob.size <= MAX_AVATAR_BYTES) return blob;
  }
  throw new Error(`头像压不到 ${MAX_AVATAR_BYTES / 1024}KB 以内`);
}

export async function uploadAvatar(file: File): Promise<string> {
  const blob = await squareJpeg(file);
  const token = await accessToken();
  const res = await fetch(PATH_AVATARS, { method: "PUT", headers: { "content-type": blob.type, authorization: `Bearer ${token}` }, body: blob });
  const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!res.ok || !body.id) throw new ApiError(res.status, body.error ?? `上传失败 (${res.status})`);
  return body.id;
}

export const listUsers = async (): Promise<UserPublic[]> => (await api<{ users: UserPublic[] }>(PATH_USERS)).users ?? [];
export const patchUser = (id: string, p: Partial<Pick<UserPublic, "role" | "status" | "display">>) => api(fill(PATH_USER, id), { method: "PATCH", body: JSON.stringify(p) });
export const approveUser = (id: string) => api(fill(PATH_USER_APPROVE, id), { method: "POST" });
export const deleteUser = (id: string) => api(fill(PATH_USER, id), { method: "DELETE" });
export const listInvites = async (): Promise<InviteInfo[]> => (await api<{ invites: InviteInfo[] }>(PATH_INVITES)).invites ?? [];
export const createInvite = (r: InviteRequest) => api<InviteCreated>(PATH_INVITES, { method: "POST", body: JSON.stringify(r) });
export const dropInvite = (id: string) => api(`${PATH_INVITES}/${encodeURIComponent(id)}`, { method: "DELETE" });
