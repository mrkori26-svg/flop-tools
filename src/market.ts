import { createHash } from "node:crypto";

export type MarketOffer = {
  schema: "flop.market-offer/v1";
  source: string;
  offerId: string;
  protocol: string;
  payer?: string;
  reward?: { amount: string; asset: string };
  funded: boolean;
  fundingStatus: "DECLARED_FUNDED" | "ADVERTISED" | "UNFUNDED";
  spec?: string;
  context?: string;
  expiresAt?: string;
  rawDigest: string;
};

export type MarketSnapshot = {
  schema: "flop.market-snapshot/v1";
  observedAt: string;
  source: string;
  offers: MarketOffer[];
};

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
};
const digest = (value: unknown) => "sha256:" + createHash("sha256").update(canonical(value)).digest("hex");
const asString = (v: unknown): string | undefined => typeof v === "string" && v.trim() ? v.trim() : undefined;
const amountString = (v: unknown): string | undefined => {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return String(v);
  if (typeof v === "string" && /^\d+(?:\.\d+)?$/.test(v.trim())) return v.trim();
  return undefined;
};

function rows(value: unknown): Record<string,unknown>[] {
  if (Array.isArray(value)) return value.filter(x=>x && typeof x === "object" && !Array.isArray(x)) as Record<string,unknown>[];
  if (!value || typeof value !== "object") return [];
  const o = value as Record<string,unknown>;
  for (const key of ["offers","open","jobs","items","data"]) {
    if (Array.isArray(o[key])) return rows(o[key]);
  }
  return [o];
}

export function normalizeMarketOffer(item: Record<string,unknown>, source: string, index=0): MarketOffer {
  const job = item.job && typeof item.job === "object" ? item.job as Record<string,unknown> : {};
  const rewardObj = item.reward && typeof item.reward === "object" ? item.reward as Record<string,unknown> : {};
  const offerId = asString(item.offerId) ?? asString(item.id) ?? asString(job.id) ?? `offer-${index}-${digest(item).slice(7,15)}`;
  const protocol = asString(item.protocol) ?? asString(item.proto) ?? asString(job.proto) ?? "unknown";
  const amount = amountString(rewardObj.amount) ?? amountString(item.amount) ?? amountString(item.reward);
  const asset = asString(rewardObj.asset) ?? asString(item.asset) ?? asString(item.currency);
  const fundedFlag = item.funded === true || item.status === "funded" || item.status === "open-funded";
  const numericFunded = amount !== undefined && Number(amount) > 0;
  const fundingStatus: MarketOffer["fundingStatus"] = fundedFlag ? "DECLARED_FUNDED" : numericFunded ? "ADVERTISED" : "UNFUNDED";
  const expiresAt = asString(item.expiresAt) ?? asString(item.expires) ?? asString(item.deadline);
  return {
    schema:"flop.market-offer/v1",
    source,
    offerId,
    protocol,
    payer: asString(item.payer) ?? asString(item.from) ?? asString(item.did),
    reward: amount && asset ? {amount,asset} : undefined,
    funded: fundedFlag || numericFunded,
    fundingStatus,
    spec: asString(item.spec) ?? asString(job.spec) ?? asString(item.task),
    context: asString(item.context) ?? asString(job.context) ?? asString(item.description),
    expiresAt,
    rawDigest:digest(item),
  };
}

export async function fetchMarketSnapshot(
  source="https://flop-market.pages.dev/open.json",
  timeoutMs=15000,
): Promise<MarketSnapshot> {
  const url = new URL(source);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1","localhost","::1"].includes(url.hostname))) {
    throw new Error("UNSAFE_MARKET_URL");
  }
  const res = await fetch(url, {signal:AbortSignal.timeout(timeoutMs), headers:{"accept":"application/json"}});
  if (!res.ok) throw new Error(`MARKET_HTTP_${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > 2 * 1024 * 1024) throw new Error("MARKET_RESPONSE_TOO_LARGE");
  const parsed = JSON.parse(bytes.toString("utf8"));
  const offers = rows(parsed).map((item,i)=>normalizeMarketOffer(item,source,i));
  return {schema:"flop.market-snapshot/v1",observedAt:new Date().toISOString(),source,offers};
}

export function mergeMarketSnapshots(...snapshots: MarketSnapshot[]): MarketOffer[] {
  const by = new Map<string,MarketOffer>();
  for (const s of snapshots) for (const o of s.offers) by.set(`${o.source}|${o.offerId}|${o.rawDigest}`,o);
  return [...by.values()].sort((a,b)=>Number(b.funded)-Number(a.funded) || a.offerId.localeCompare(b.offerId));
}
