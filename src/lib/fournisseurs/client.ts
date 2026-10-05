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
  // Filet de sécurité : jamais de `reasoning_content` dans l'historique envoyé
  // (Groq le refuse : « property 'reasoning_content' is unsupported »).
  if (Array.isArray(c.messages)) {
    c.messages = (c.messages as unknown[]).map((m) => {
      if (!m || typeof m !== "object" || !("reasoning_content" in m)) return m;
      const { reasoning_content: _ignore, ...reste } = m as Record<string, unknown>;
      void _ignore;
      return reste;
    });
  }
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
      // Qwen 3.8 chez Cloudflare raisonne toujours : niveaux acceptés low / medium / xhigh (défaut).
      // « Aucun » devient donc « low », le minimum ; le raisonnement arrive dans delta.reasoning.
      c.reasoning_effort = raisonnement === "eleve" ? "xhigh" : raisonnement === "moyen" ? "medium" : "low";
      break;
    case "nvidia": {
      // NVIDIA NIM (Kimi K3) : la réflexion se pilote par chat_template_kwargs.thinking. Sans
      // réflexion, les appels d'outils échouent : on la garde dès que des outils sont envoyés.
      // reasoning_effort « low » donne parfois une réponse vide : on ne l'utilise pas.
      const outils = Array.isArray(c.tools) && c.tools.length > 0;
      const reflechir = raisonnement !== "aucun" || outils;
      c.chat_template_kwargs = { ...((c.chat_template_kwargs as Record<string, unknown>) ?? {}), thinking: reflechir };
      if (raisonnement === "moyen") c.reasoning_effort = "high";
      else if (raisonnement === "eleve") c.reasoning_effort = "max";
      else delete c.reasoning_effort;
      break;
    }
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
  /** Cloudflare : neurons consommés (10 000 gratuits par jour). */
  neurons?: number;
}

function lireMeta(corps: unknown): Record<string, number | string> | undefined {
  if (!corps || typeof corps !== "object") return undefined;
  const o = corps as Record<string, unknown>;
  const usage = (o.usage ?? null) as Record<string, unknown> | null;
  const m: Record<string, number | string> = {};
  if (usage && typeof usage.cost === "number") m.cout = usage.cost;
  if (usage && typeof usage.neurons === "number") m.neurons = usage.neurons;
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
            if (!m) return;
            // Les neurons sont donnés par chunk, puis en total sur le dernier : on garde le maximum.
            const neurons = Math.max(Number(acc?.neurons ?? 0), Number(m.neurons ?? 0));
            acc = { ...acc, ...m, ...(neurons ? { neurons } : {}) };
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
