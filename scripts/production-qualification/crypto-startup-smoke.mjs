// Local production-build negative startup smoke. No hosted service or gate.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','58677'],{
 env:{...process.env,NODE_ENV:'production',RELAY_DEPLOYMENT_MODE:'production',RELAY_V2_ACTIONS_ENABLED:'true',RELAY_FEDERATION_ENABLED:'true',RELAY_CRYPTO_BACKEND:'managed-secret',RELAY_ISSUER_URL:'https://relay.example.invalid'},stdio:['ignore','pipe','pipe']});
let log='';child.stdout.on('data',c=>{log+=c;});child.stderr.on('data',c=>{log+=c;});
try{
 let status;
 for(let i=0;i<80;i++){
  if(child.exitCode!==null)break;
  try{const response=await fetch('http://127.0.0.1:58677/api/v2/federation',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operation:'poll'}),signal:AbortSignal.timeout(1000)});status=response.status;if(status>=500)break;}
  catch{ /* startup can refuse the connection before serving requests */ }
  await new Promise(r=>setTimeout(r,250));
 }
 assert.ok((child.exitCode!==null && child.exitCode!==0) || status>=500,'Production must refuse unavailable hosted crypto');
 assert.match(log,/cryptographic configuration is unavailable or invalid/);
 console.log(JSON.stringify({scope:'local production build; not hosted qualification',managedSecretProductionStartup:'REJECTED',httpStatus:status??null,kmsHostedStartup:'NOT_RUN'}));
}finally{
 if(child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},5000);child.once('exit',()=>{clearTimeout(timer);resolve();});});}
}
