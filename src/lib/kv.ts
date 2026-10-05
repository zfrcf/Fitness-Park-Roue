/**
 * Couche clé-valeur : Upstash Redis si les variables d'environnement sont
 * présentes, sinon une mémoire de processus (suffisante en développement).
 */
import { Redis } from "@upstash/redis";

export interface KV {
  get<T = unknown>(cle: string): Promise<T | null>;
  set(cle: string, valeur: unknown, ttlSecondes?: number): Promise<void>;
  del(cle: string): Promise<void>;
  /** Incrémente et pose un TTL si la clé vient d'être créée. Renvoie la valeur. */
  incr(cle: string, ttlSecondes: number): Promise<number>;
  ttl(cle: string): Promise<number>;
  keys(prefixe: string): Promise<string[]>;
  readonly type: "redis" | "memoire";
}

class KVMemoire implements KV {
  readonly type = "memoire" as const;
  private donnees = new Map<string, { valeur: unknown; expire: number | null }>();

  private vivant(cle: string) {
    const e = this.donnees.get(cle);
    if (!e) return null;
    if (e.expire !== null && e.expire <= Date.now()) {
      this.donnees.delete(cle);
      return null;
    }
    return e;
  }
  async get<T>(cle: string) {
    return (this.vivant(cle)?.valeur as T) ?? null;
  }
  async set(cle: string, valeur: unknown, ttl?: number) {
    this.donnees.set(cle, {
      valeur,
      expire: ttl ? Date.now() + ttl * 1000 : null,
    });
  }
  async del(cle: string) {
    this.donnees.delete(cle);
  }
  async incr(cle: string, ttl: number) {
    const e = this.vivant(cle);
    const n = (typeof e?.valeur === "number" ? e.valeur : 0) + 1;
    this.donnees.set(cle, {
      valeur: n,
      expire: e?.expire ?? Date.now() + ttl * 1000,
    });
    return n;
  }
  async ttl(cle: string) {
    const e = this.vivant(cle);
    if (!e) return -2;
    if (e.expire === null) return -1;
    return Math.max(0, Math.ceil((e.expire - Date.now()) / 1000));
  }
  async keys(prefixe: string) {
    return [...this.donnees.keys()].filter(
      (k) => k.startsWith(prefixe) && this.vivant(k),
    );
  }
}

class KVRedis implements KV {
  readonly type = "redis" as const;
  constructor(private redis: Redis) {}
  async get<T>(cle: string) {
    return (await this.redis.get<T>(cle)) ?? null;
  }
  async set(cle: string, valeur: unknown, ttl?: number) {
    if (ttl) await this.redis.set(cle, valeur, { ex: ttl });
    else await this.redis.set(cle, valeur);
  }
  async del(cle: string) {
    await this.redis.del(cle);
  }
  async incr(cle: string, ttl: number) {
    const n = await this.redis.incr(cle);
    // EXPIRE … NX : pose le TTL s'il manque (premier incr, ou expire précédent échoué après un crash)
    // sans jamais l'étendre sur les incr suivants. Évite un verrou permanent. (#34)
    await this.redis.expire(cle, ttl, "NX");
    return n;
  }
  async ttl(cle: string) {
    return this.redis.ttl(cle);
  }
  async keys(prefixe: string) {
    const resultat: string[] = [];
    let curseur = "0";
    do {
      const [suivant, lot] = await this.redis.scan(curseur, {
        match: `${prefixe}*`,
        count: 100,
      });
      resultat.push(...lot);
      curseur = String(suivant);
    } while (curseur !== "0");
    return resultat;
  }
}

declare global {
  var __kv: KV | undefined;
}

export function getKV(): KV {
  if (globalThis.__kv) return globalThis.__kv;
  const url =
    process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  globalThis.__kv =
    url && token ? new KVRedis(new Redis({ url, token })) : new KVMemoire();
  return globalThis.__kv;
}
