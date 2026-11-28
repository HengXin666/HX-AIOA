import { THEME_ACCENTS, useTheme, type ThemeAccent, type ThemeMode } from "@hx/ui/theme";
import { ToggleGroup, ToggleGroupItem } from "@hx/ui/ui/toggle-group";
import { Group } from "./parts";

const MODES: { value: ThemeMode; label: string }[] = [
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
  { value: "system", label: "跟随系统" },
];
const ACCENT_TEXT: Record<ThemeAccent, string> = { ink: "墨", indigo: "靛蓝", emerald: "翠绿", rose: "玫红", amber: "琥珀", zinc: "石墨" };

// 外观 (对照安卓 me-look): 明暗与主题色; 圆角与密度由 HX-UI 令牌统一, Web 端不单独调
export default function Look() {
  const { mode, setMode, accent, setAccent } = useTheme();
  return (
    <>
      <Group title="明暗">
        <ToggleGroup type="single" variant="outline" value={mode} onValueChange={(v) => v && setMode(v as ThemeMode)}>
          {MODES.map((m) => (
            <ToggleGroupItem key={m.value} value={m.value}>
              {m.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Group>
      <Group title="主题色">
        <div className="flex flex-wrap gap-2">
          {THEME_ACCENTS.map((a) => (
            <button
              key={a}
              type="button"
              data-theme={a}
              onClick={() => setAccent(a)}
              aria-pressed={accent === a}
              className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${accent === a ? "border-primary text-foreground" : "border-border text-muted-foreground"}`}
            >
              <span className="size-3 rounded-full bg-primary" />
              {ACCENT_TEXT[a] ?? a}
            </button>
          ))}
        </div>
      </Group>
    </>
  );
}
