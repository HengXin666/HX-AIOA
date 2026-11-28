import { Avatar, AvatarBadge, AvatarFallback, AvatarImage } from "@hx/ui/ui/avatar";
import { useAvatar } from "../core/avatars";

export function UserAvatar({ id, name, online, size }: { id?: string; name: string; online?: boolean; size?: "sm" | "default" | "lg" }) {
  const url = useAvatar(id);
  return (
    <Avatar size={size}>
      {url && <AvatarImage src={url} alt="" />}
      <AvatarFallback>{name.slice(0, 1) || "?"}</AvatarFallback>
      {online !== undefined && <AvatarBadge className={online ? "bg-success" : "bg-muted-foreground"} />}
    </Avatar>
  );
}
