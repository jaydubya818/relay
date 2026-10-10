import { execFile as callback } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const execFile = promisify(callback), directory = await mkdtemp(join(tmpdir(), 'relay-capability-'));
const bin = process.env.CAPABILITY_TEST_POSTGRES_BIN ?? '/opt/homebrew/opt/postgresql@17/bin';
let started = false;
try {
  await execFile(join(bin,'initdb'),['-D',join(directory,'data'),'-U','capability_admin','--auth-local=trust','--auth-host=trust','--no-locale','-E','UTF8']);
  await execFile(join(bin,'pg_ctl'),['-D',join(directory,'data'),'-l',join(directory,'log'),'-o',`-k ${directory} -h 127.0.0.1 -p 55495`,'-w','start']); started=true;
  const env={...process.env,RELAY_TEST_DATABASE_URL:'postgresql://capability_admin@127.0.0.1:55495/postgres'};
  delete env.RELAY_DATABASE_URL;
  const {stdout,stderr}=await execFile('pnpm',['exec','vitest','run','tests/v2/policy-propagation.test.ts','tests/v2/capability-maintenance.test.ts','tests/v2/leases.test.ts','tests/v2/capability-administration.test.ts','tests/v2/capability-administration-route.test.ts','tests/v2/policy.test.ts','tests/v2/passports.test.ts','tests/federation/message-policy.test.ts','tests/federation/federation.test.ts','--fileParallelism=false','--testTimeout=20000'],{env,maxBuffer:5_000_000});
  process.stdout.write(stdout); process.stderr.write(stderr);
  await mkdir('docs/capability-control/evidence',{recursive:true});
  await writeFile('docs/capability-control/evidence/administration.txt',(stdout+'\n'+stderr).trim()+'\n');
} finally {
  if(started) await execFile(join(bin,'pg_ctl'),['-D',join(directory,'data'),'-m','immediate','-w','stop']);
  await rm(directory,{recursive:true,force:true});
}
