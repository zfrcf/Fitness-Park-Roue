import type { MessageUI } from "@/lib/chat/types";

/** Parties à afficher : après un marqueur de régénération, tout ce qui précède est ignoré. */
export function partiesVisibles(m: MessageUI): MessageUI["parts"] {
  const idx = m.parts.map((p) => p.type).lastIndexOf("data-regeneration");
  return idx >= 0 ? m.parts.slice(idx + 1) : m.parts;
}

export function texteDuMessage(m: MessageUI): string {
  return partiesVisibles(m)
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("");
}
