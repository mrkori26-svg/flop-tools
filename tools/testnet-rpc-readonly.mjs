#!/usr/bin/env node
/** Strictly read-only FLOP Testnet genesis/finality probe. Requires Node.js >=22. */
export const EXPECTED_GENESIS = '0x918abd58fb16306b30ef3886514cfaebffecb4de43e82b6f8ec4795c43cfd800';
export const DEFAULT_RPC = 'wss://testnet.flop.network/';
export function assertHash(hash, label) {
  if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error(`${label}: invalid 32-byte hash`);
  return hash.toLowerCase();
}
export function parseRpcResponse(raw, id) {
  const result = JSON.parse(raw);
  if (result.jsonrpc !== '2.0' || result.id !== id) return null;
  if (result.error) throw new Error(`RPC error: ${JSON.stringify(result.error)}`);
  if (!Object.hasOwn(result, 'result')) throw new Error('Missing result');
  return result.result;
}
export async function probe(rpc = DEFAULT_RPC, { WebSocketImpl = globalThis.WebSocket, timeoutMs = 10000 } = {}) {
  if (rpc !== DEFAULT_RPC) throw new Error('Only the exact official Testnet RPC is allowed');
  if (!WebSocketImpl) throw new Error('WebSocket unavailable: Node.js >=22 required');
  const socket = new WebSocketImpl(rpc);
  const pending = new Map();
  let nextId = 1;
  let timer;
  try {
    const opened = new Promise((resolve,reject) => {
      socket.addEventListener('open', resolve, {once:true});
      socket.addEventListener('error', () => reject(new Error('WebSocket connection error')), {once:true});
      socket.addEventListener('close', () => reject(new Error('WebSocket closed before response')), {once:true});
      socket.addEventListener('message', event => {
        try {
          const response = JSON.parse(String(event.data));
          const pair = pending.get(response.id);
          if (!pair) return;
          pending.delete(response.id);
          if (response.jsonrpc !== '2.0' || response.error || !Object.hasOwn(response,'result')) pair.reject(new Error('Invalid or failed JSON-RPC response'));
          else pair.resolve(response.result);
        } catch (err) { for (const pair of pending.values()) pair.reject(err); pending.clear(); }
      });
    });
    const timed = new Promise((_,reject) => {timer=setTimeout(() => reject(new Error('RPC probe timed out')),timeoutMs);});
    await Promise.race([opened,timed]);
    const call = (method,params=[]) => {
      const id=nextId++;
      return new Promise((resolve,reject)=> {pending.set(id,{resolve,reject});socket.send(JSON.stringify({jsonrpc:'2.0',id,method,params}));});
    };
    const genesis=assertHash(await Promise.race([call('chain_getBlockHash',[0]),timed]),'genesis');
    if (genesis !== EXPECTED_GENESIS) throw new Error(`Genesis mismatch: ${genesis}`);
    const finalizedHash=assertHash(await Promise.race([call('chain_getFinalizedHead'),timed]),'finalized head');
    const header=await Promise.race([call('chain_getHeader',[finalizedHash]),timed]);
    if (!header || typeof header.number !== 'string' || !/^0x[0-9a-fA-F]+$/.test(header.number)) throw new Error('Invalid finalized header');
    return {rpc,genesis,finalizedHash,finalizedHeight:header.number,verified:true};
  } finally {
    clearTimeout(timer);
    for (const pair of pending.values()) pair.reject(new Error('Probe closing'));
    if (socket && typeof socket.close === 'function') socket.close();
  }
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  probe().then(x=>{console.log(JSON.stringify(x,null,2));}).catch(err=>{console.error(err.message);process.exitCode=1;});
}
