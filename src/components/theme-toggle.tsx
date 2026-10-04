"use client";

import { Moon, Sun, Monitor } from "lucide-react";
import { useTheme } from "next-themes";
import { useMounted } from "@/hooks/use-mounted";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const ORDRE = ["system", "light", "dark"] as const;
const LIBELLES: Record<(typeof ORDRE)[number], string> = {
  system: "Thème : système",
  light: "Thème : clair",
  dark: "Thème : sombre",
};

export function ThemeToggle() {
  const { setTheme, theme } = useTheme();
  const mounted = useMounted();

  const courant = (mounted && (theme as (typeof ORDRE)[number])) || "system";
  const suivant = ORDRE[(ORDRE.indexOf(courant) + 1) % ORDRE.length];

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={LIBELLES[courant]}
            onClick={() => setTheme(suivant)}
          />
        }
      >
        {courant === "system" ? (
          <Monitor className="size-4" />
        ) : courant === "light" ? (
          <Sun className="size-4" />
        ) : (
          <Moon className="size-4" />
        )}
      </TooltipTrigger>
      <TooltipContent>{LIBELLES[courant]}</TooltipContent>
    </Tooltip>
  );
}
