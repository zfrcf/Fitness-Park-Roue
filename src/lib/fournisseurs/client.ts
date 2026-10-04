import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { Fournisseur, NiveauRaisonnement } from "./types";

export interface OptionsModele {
  raisonnement: NiveauRaisonnement;
}

const EFFORT: Record<Exclude<NiveauRaisonnement, "aucun">, "low" | "medium" | "high"> = {
  faible: "low",
  moyen: "medium",
  eleve: "high",
};

/** Paramètres propres à chaque famille d'API, injectés dans le corps de la requête. */
export function adapterCorps(
  f: Fournisseur,
  corps: Record<string, unknown>,
  { raisonnement }: OptionsModele,
): Record<string, unknown> {
  const c = { ...corps };
  switch (f.famille) {
    case "groq":
      // Doc Groq : reasoning_effort none/low/medium/high (modèles raisonneurs).
      c.reasoning_effort = raisonnement === "aucun" ? "none" : EFFORT[raisonnement];
      break;
    case "openrouter":
      // Doc OpenRouter : reasoning.enabled / reasoning.effort ; l'usage est toujours renvoyé.
      c.reasoning = raisonnement === "aucun" ? { enabled: false } : { effort: EFFORT[raisonnement] };
      break;
    case "cloudflare":
      // Workers AI applique un max_tokens très bas par défaut : on l'envoie toujours.
      if (c.max_tokens === undefined) c.max_tokens = 4096;
      if (raisonnement === "aucun") c.reasoning_effort = "none";
      else c.reasoning_effort = EFFORT[raisonnement];
      break;
    default:
      break;
  }
  return c;
}

/** Métadonnées utiles renvoyées par certains fournisseurs (coût, fournisseur amont). */
export interface MetaFournisseur {
  cout?: number;
  amont?: string;
  tokensRaisonnement?: number;
}

function lireMeta(corps: unknown): Record<string, number | string> | undefined {
  if (!corps || typeof corps !== "object") return undefined;
  const o = corps as Record<string, unknown>;
  const usage = (o.usage ?? null) as Record<string, unknown> | null;
  const m: Record<string, number | string> = {};
  if (usage && typeof usage.cost === "number") m.cout = usage.cost;
  const details = usage?.completion_tokens_details as Record<string, unknown> | undefined;
  if (details && typeof details.reasoning_tokens === "number") m.tokensRaisonnement = details.reasoning_tokens;
  if (typeof o.provider === "string") m.amont = o.provider;
  return Object.keys(m).length ? m : undefined;
}

export function creerModele(f: Fournisseur, options: OptionsModele): LanguageModel {
  const headers: Record<string, string> = {};
  if (f.famille === "openrouter") {
    headers["HTTP-Referer"] = process.env.APP_URL ?? "http://localhost:3000";
    headers["X-Title"] = "Chat IA personnel";
  }
  const provider = createOpenAICompatible({
    name: f.famille === "generique" ? `fournisseur-${f.rang}` : f.famille,
    baseURL: f.baseUrl,
    apiKey: f.apiKey,
    headers,
    includeUsage: true,
    transformRequestBody: (corps) => adapterCorps(f, corps, options),
    metadataExtractor: {
      async extractMetadata({ parsedBody }) {
        const m = lireMeta(parsedBody);
        return m ? { [f.famille]: m } : undefined;
      },
      createStreamExtractor() {
        let acc: Record<string, number | string> | undefined;
        return {
          processChunk(chunk) {
            const m = lireMeta(chunk);
            if (m) acc = { ...acc, ...m };
          },
          buildMetadata() {
            return acc ? { [f.famille]: acc } : undefined;
          },
        };
      },
    },
  });
  return provider.chatModel(f.modele);
}
