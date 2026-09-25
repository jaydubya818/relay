import { setTimeout as delay } from 'node:timers/promises';
import { assertQualificationConfiguration, qualificationRpc } from '../../lib/qualification';
import { expireFederationContent } from '../../lib/v2/federation/service';
import { closeDatabase } from '../../lib/db';

async function main(){
 assertQualificationConfiguration();
 const database=new URL(process.env.RELAY_DATABASE_URL??process.env.DATABASE_URL??'').pathname.slice(1);
 if(!/^fq_relay_[a-f0-9]{12}$/.test(database))throw new Error('Synthetic database required.');
 const shutdown=new AbortController();
 process.once('SIGTERM',()=>shutdown.abort());process.once('SIGINT',()=>shutdown.abort());
 try{
  while(!shutdown.signal.aborted){
   await qualificationRpc('active',{},shutdown.signal);
   await expireFederationContent();
   await delay(5000,undefined,{signal:shutdown.signal});
  }
 }catch(error){if(!shutdown.signal.aborted)throw error;}
 finally{await closeDatabase();}
}
main().catch(()=>{console.error('Qualification worker stopped.');process.exitCode=1;});
