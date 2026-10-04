/**
 * Faux serveur compatible OpenAI pour les tests de rotation.
 * Le comportement dépend de la clé API envoyée (Authorization: Bearer <scenario>).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export type Scenario =
  | "ok" // réponse normale en flux
  | "ok-continue" // réponse normale ; si continuation demandée, renvoie la suite
  | "429" // limite de débit avec retry-after
  | "429-quotidien" // quota journalier OpenRouter
  | "402"
  | "401"
  | "500"
  | "coupe-flux" // émet du texte puis un chunk d'erreur
  | "coupe-socket" // émet du texte puis ferme brutalement la connexion
  | "muet" // ne répond jamais (chien de garde)
  | "contexte" // 400 contexte trop long sauf si le prompt est court
  | "413-itpm" // Groq : requête trop grande pour la fenêtre de tokens par minute, sauf si le prompt est court
  | "cf-3036" // Cloudflare quota journalier
  | "outil" // appelle l'outil recherche_web, puis répond avec le résultat
  | "outil-refuse"; // 400 si des outils sont envoyés, sinon réponse normale

export interface Appel {
  scenario: string;
  corps: Record<string, unknown>;
}

export interface FauxServeur {
  url: string;
  appels: Appel[];
  fermer: () => Promise<void>;
  serveur: Server;
}

function lireCorps(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((res) => {
    let s = "";
    req.on("data", (d) => (s += d));
    req.on("end", () => {
      try {
        res(JSON.parse(s || "{}"));
      } catch {
        res({});
      }
    });
  });
}

function chunk(id: string, delta: string, extra: Record<string, unknown> = {}) {
  return `data: ${JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created: 1,
    model: "faux",
    choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
    ...extra,
  })}\n\n`;
}

function finChunk(id: string, promptTokens: number, completionTokens: number) {
  return (
    `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: 1, model: "faux", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n` +
    `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: 1, model: "faux", choices: [], usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens, cost: 0.001 } })}\n\n` +
    "data: [DONE]\n\n"
  );
}

function texteDuPrompt(corps: Record<string, unknown>): string {
  const msgs = (corps.messages as Array<{ role: string; content: unknown }>) ?? [];
  return msgs.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");
}

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function demarrerFauxServeur(): Promise<FauxServeur> {
  const appels: Appel[] = [];
  const serveur = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const scenario = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const corps = await lireCorps(req);
    appels.push({ scenario, corps });
    const prompt = texteDuPrompt(corps);
    const continuation = /Reprends EXACTEMENT/.test(prompt);
    const resume = /Résume fidèlement/.test(String(corps.messages ? JSON.stringify(corps.messages) : ""));
    const json = (statut: number, obj: unknown, entetes: Record<string, string> = {}) => {
      res.writeHead(statut, { "content-type": "application/json", ...entetes });
      res.end(JSON.stringify(obj));
    };
    const sse = () => res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const id = "chatcmpl-" + Math.random().toString(36).slice(2);
    const nonStream = corps.stream !== true;
    const reponseJson = (texte: string, promptTokens: number, completionTokens: number) =>
      json(200, {
        id,
        object: "chat.completion",
        created: 1,
        model: "faux",
        choices: [{ index: 0, message: { role: "assistant", content: texte }, finish_reason: "stop" }],
        usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
      });

    switch (scenario) {
      case "429":
        return json(
          429,
          { error: { message: "Rate limit reached for model. Limit 8000, Used 7900, Requested 500. Please try again in 2m0s.", type: "tokens", code: "rate_limit_exceeded" } },
          { "retry-after": "120", "x-ratelimit-reset-tokens": "2m0s", "x-ratelimit-remaining-tokens": "0", "x-ratelimit-limit-tokens": "8000" },
        );
      case "429-quotidien":
        return json(429, { error: { code: 429, message: "Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day", metadata: {} } });
      case "cf-3036":
        return json(429, { success: false, errors: [{ code: 3036, message: "Account limited: You have used up your daily free allocation of 10,000 neurons." }], result: null });
      case "402":
        return json(402, { error: { code: 402, message: "Insufficient credits. Add more using https://openrouter.ai/settings/credits" } });
      case "401":
        return json(401, { error: { message: "Invalid API Key", type: "invalid_request_error", code: "invalid_api_key" } });
      case "500":
        return json(500, { error: { message: "Internal server error", type: "server_error" } });
      case "contexte": {
        if (prompt.length > 2000) {
          return json(400, { error: { message: "This model's maximum context length is 1000 tokens. However, you requested 1500 tokens. Please reduce the length of the messages.", type: "invalid_request_error", code: "context_length_exceeded" } });
        }
        if (nonStream) return reponseJson(resume ? "RÉSUMÉ-DES-ANCIENS-MESSAGES" : "Réponse courte.", 50, 3);
        sse();
        res.write(chunk(id, "Réponse courte."));
        res.end(finChunk(id, 50, 3));
        return;
      }
      case "413-itpm": {
        if (prompt.length > 2000) {
          return json(413, { error: { message: "Request too large for model on input tokens per minute (ITPM): Limit 7000, Requested 12069, please reduce your message size and try again.", type: "tokens", code: "rate_limit_exceeded" } });
        }
        if (nonStream) return reponseJson("Réponse courte.", 50, 3);
        sse();
        res.write(chunk(id, "Réponse courte."));
        res.end(finChunk(id, 50, 3));
        return;
      }
      case "outil-refuse": {
        if (corps.tools) return json(400, { error: { message: "This model does not support tools / function calling", type: "invalid_request_error" } });
        sse();
        res.write(chunk(id, "Réponse sans outil."));
        res.end(finChunk(id, 20, 4));
        return;
      }
      case "outil": {
        const msgs = corps.messages as Array<{ role: string; content?: unknown }>;
        const resultatOutil = msgs.find((m) => m.role === "tool");
        sse();
        if (!resultatOutil) {
          // Premier tour : appel d'outil en flux (format OpenAI).
          res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: 1, model: "faux", choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "recherche_web", arguments: "" } }] }, finish_reason: null }] })}\n\n`);
          res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: 1, model: "faux", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ requete: "minecraft 1.21.11" }) } }] }, finish_reason: null }] })}\n\n`);
          res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: 1, model: "faux", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 } })}\n\n`);
          res.end("data: [DONE]\n\n");
          return;
        }
        const contenu = String(resultatOutil.content);
        res.write(chunk(id, contenu.includes("1.21.11") ? "D'après la recherche, la 1.21.11 existe." : "Recherche sans résultat."));
        res.end(finChunk(id, 60, 9));
        return;
      }
      case "muet":
        sse();
        return; // jamais de données
      case "coupe-flux": {
        sse();
        res.write(chunk(id, "Bonjour, voici "));
        await attendre(10);
        res.write(chunk(id, "le début de "));
        await attendre(10);
        res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", error: { code: 502, message: "Provider returned error", metadata: { provider_name: "Faux" } }, choices: [{ index: 0, finish_reason: "error" }] })}\n\n`);
        res.end();
        return;
      }
      case "coupe-socket": {
        sse();
        res.write(chunk(id, "Première partie "));
        await attendre(10);
        res.write(chunk(id, "avant la coupure"));
        await attendre(10);
        req.socket.destroy();
        return;
      }
      case "ok-continue":
      case "ok":
      default: {
        if (nonStream) return reponseJson(resume ? "RÉSUMÉ-DES-ANCIENS-MESSAGES" : "Réponse entière du fournisseur " + scenario + ".", 30, 7);
        sse();
        if (continuation) {
          // Reprend « à la suite », en répétant volontairement les derniers mots pour tester la fusion.
          const dernierMsgAssistant = ((corps.messages as Array<{ role: string; content: string }>).filter((m) => m.role === "assistant").at(-1)?.content ?? "") as string;
          const queue = dernierMsgAssistant.slice(-8);
          res.write(chunk(id, queue + "la réponse "));
          await attendre(5);
          res.write(chunk(id, "complète."));
          res.end(finChunk(id, 40, 6));
          return;
        }
        res.write(chunk(id, "Réponse "));
        await attendre(5);
        res.write(chunk(id, "entière du "));
        await attendre(5);
        res.write(chunk(id, "fournisseur " + scenario + "."));
        res.end(finChunk(id, 30, 7));
        return;
      }
    }
  });
  await new Promise<void>((r) => serveur.listen(0, "127.0.0.1", () => r()));
  const port = (serveur.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    appels,
    serveur,
    fermer: () => new Promise((r) => serveur.close(() => r())),
  };
}
