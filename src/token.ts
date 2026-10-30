export interface TokenStorage {getItem(key:string):string|null;setItem(key:string,value:string):void;}
/** Resolve on every request; tabs can remain open longer than the capability lifetime. */
export function getWorkspaceToken(storage:TokenStorage,now=Date.now()):string {
 const token=storage.getItem('webhooklab-token');
 const created=Number(storage.getItem('webhooklab-token-created')||0);
 if(token&&/^[0-9a-f]{64}$/.test(token)&&Number.isFinite(created)&&created>0&&created<=now&&now-created<6*86400000)return token;
 const fresh=Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');
 storage.setItem('webhooklab-token',fresh);
 storage.setItem('webhooklab-token-created',String(now));
 return fresh;
}
