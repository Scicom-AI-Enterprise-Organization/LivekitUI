import { Badge } from "@/components/ui/badge";
import { KeyRound, Github, ShieldCheck } from "lucide-react";

/** Mirrors AuthProvider in @/lib/db — kept as a plain string for client use. */
export type LoginType = "local" | "keycloak" | "github" | string;

const LOGIN_TYPES: Record<
  string,
  { label: string; icon: React.ElementType }
> = {
  local: { label: "Local", icon: KeyRound },
  keycloak: { label: "Keycloak", icon: ShieldCheck },
  github: { label: "GitHub", icon: Github },
};

export function LoginTypeBadge({ type }: { type: LoginType }) {
  const meta = LOGIN_TYPES[type] ?? {
    label: type.charAt(0).toUpperCase() + type.slice(1),
    icon: ShieldCheck,
  };
  const Icon = meta.icon;

  return (
    <Badge variant="outline" className="text-muted-foreground">
      <Icon className="size-3" />
      {meta.label}
    </Badge>
  );
}
