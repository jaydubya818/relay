import { runChannelCancellationCycle } from "../lib/v2/channels/cancellation";
import { closeDatabase } from "../lib/db";
import { channelConfiguration } from "../lib/v2/channels/config";
import { telegramReadiness } from "../lib/v2/channels/http";
import { HttpOwnerExecutor } from "../lib/v2/channels/executor";
import { TelegramOwnerSender,runChannelDeliveryCycle } from "../lib/v2/channels/delivery";
import { runChannelExecutionCycle } from "../lib/v2/channels/worker";
async function main(){
  const config=channelConfiguration();const ready=await telegramReadiness(config);
  if(!ready.storageAvailable||config.issues.length||!config.signer){console.info(JSON.stringify({event:"channel_worker_not_ready",issues:ready.issues,storageAvailable:ready.storageAvailable}));await closeDatabase();return;}
  const executor=new HttpOwnerExecutor({endpoint:config.endpoint,audience:config.audience,environment:config.environment,signer:config.signer});
  const sender=new TelegramOwnerSender(config.botToken);let stopped=false;
  process.once("SIGTERM",()=>{stopped=true;});process.once("SIGINT",()=>{stopped=true;});
  while(!stopped){
    try{await runChannelCancellationCycle(config,executor,config.signer);await runChannelExecutionCycle(config,executor,config.signer);await runChannelDeliveryCycle(config,sender,config.signer);}
    catch{console.error(JSON.stringify({event:"channel_worker_cycle_failed",code:"UNAVAILABLE"}));}
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  await closeDatabase();
}
main().catch(async()=>{console.error(JSON.stringify({event:"channel_worker_failed",code:"UNAVAILABLE"}));await closeDatabase();process.exitCode=1;});
