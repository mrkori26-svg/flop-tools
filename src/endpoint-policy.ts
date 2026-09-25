import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const PRIVATE_V4 = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
] as const;

function v4Number(value: string): number {
  return value.split(".").reduce((n, part) => ((n << 8) | Number(part)) >>> 0, 0);
}

function inV4Cidr(address: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (v4Number(address) & mask) === (v4Number(base) & mask);
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    return !PRIVATE_V4.some(([base, bits]) => inV4Cidr(address, base, bits));
  }
  if (family === 6) {
    const value = address.toLowerCase();
    if (value === "::" || value === "::1") return false;
    if (value.startsWith("fc") || value.startsWith("fd")) return false;
    if (/^fe[89ab]/.test(value)) return false;
    if (value.startsWith("ff")) return false;
    if (value.startsWith("::ffff:")) {
      const mapped = value.slice("::ffff:".length);
      return isIP(mapped) === 4 && isPublicAddress(mapped);
    }
    return true;
  }
  return false;
}

export async function assertPublicAgentEndpoint(endpoint: string): Promise<URL> {
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new Error("REMOTE_ENDPOINT_INVALID"); }
  if (url.protocol !== "https:") throw new Error("REMOTE_ENDPOINT_HTTPS_REQUIRED");
  if (url.username || url.password) throw new Error("REMOTE_ENDPOINT_CREDENTIALS_FORBIDDEN");
  if (!url.hostname || ["localhost", "localhost.localdomain"].includes(url.hostname.toLowerCase())) {
    throw new Error("REMOTE_ENDPOINT_PRIVATE");
  }
  const directFamily = isIP(url.hostname);
  if (directFamily) {
    if (!isPublicAddress(url.hostname)) throw new Error("REMOTE_ENDPOINT_PRIVATE");
    return url;
  }
  const answers = await lookup(url.hostname, { all: true, verbatim: true });
  if (!answers.length || answers.some(answer => !isPublicAddress(answer.address))) {
    throw new Error("REMOTE_ENDPOINT_PRIVATE");
  }
  return url;
}
