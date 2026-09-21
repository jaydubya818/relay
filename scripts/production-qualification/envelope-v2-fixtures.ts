/** Synthetic, schema-valid fixtures; no provider access or persistent key material. */
import assert from 'node:assert/strict';
import { canonicalJson } from '../../lib/v2/contracts';
import { submissionSchema, viewSchema } from '../../lib/v2/federation/contracts';
import { federationV2Header } from '../../lib/v2/federation/signing-envelope';
export const qualificationIssuer='https://relay.synthetic.invalid';
export const qualificationAudience='relay://fq-owner-b/fq-agent-b';
export const qualificationKeyVersion='projects/relay-local-qualification/locations/us-east4/keyRings/fq-compatibility-probe/cryptoKeys/fq-ed25519-probe/cryptoKeyVersions/1';
export interface EnvelopeFixture { name:string; envelope:Record<string,unknown>; keyId:string; materialBytes:number }
export function envelopeV2Fixtures(clock:Date, targets=[260000,262057]):EnvelopeFixture[] {
  const createdAt=clock.toISOString(),expiresAt=new Date(+clock+600000).toISOString();
  const base={id:'fq-request-0001',protocol:'relay.federation',version:'1.0',caller:{ownerId:'fq-owner-a',agentId:'fq-agent-a'},target:{ownerId:'fq-owner-b',agentId:'fq-agent-b',address:qualificationAudience},resource:'fq-resource',createdAt,expiresAt,idempotencyKey:'fq-request-0001',publication:null,authorizationContext:{grantId:'fq-grant',policyDecisionId:'fq-decision',localAuthorizationRequired:true}};
  const inputBytes=(envelope:Record<string,unknown>,keyId:string)=>[
    federationV2Header(keyId,qualificationKeyVersion),
    {iss:qualificationIssuer,aud:qualificationAudience,jti:base.id,iat:Math.floor(+clock/1000),exp:Math.floor(+clock/1000)+60,envelope},
  ].map(x=>Buffer.from(canonicalJson(x)).toString('base64url')).join('.').length;
  const keyId='fq-delivery-v2';
  const small=[
    {name:'small',envelope:{...base,capability:'message.send',payload:{subject:'Qualification',body:'Synthetic federation message.'}}},
    {name:'intermediate',envelope:{...base,capability:'message.send',payload:{subject:'s'.repeat(200),body:'a'.repeat(16000),replyTo:'r'.repeat(255)}}},
    {name:'64K-class',envelope:{...base,capability:'work.request',payload:{category:'artifact_generation',task:'\0'.repeat(4000),expectedOutput:'\0'.repeat(1000),context:Array(10).fill('\0'.repeat(255)),budget:{runtimeSeconds:3600,cost:'999999.999999999',modelSteps:100,delegatedWorkers:0},deadline:expiresAt}}},
    {name:'132K-class',envelope:{...base,capability:'message.send',payload:{subject:'\0'.repeat(200),body:'\0'.repeat(16000),replyTo:'\0'.repeat(255)}}},
  ];
  const fixtures:EnvelopeFixture[]=small.map(f=>({...f,keyId,materialBytes:inputBytes(f.envelope,keyId)}));
  const long='\0'.repeat(255);
  const query={mode:'RECORD_RETRIEVAL',query:'\0'.repeat(4000),requestedTypes:Array(30).fill(long),topics:Array(30).fill('\0'.repeat(100)),maxRecords:50};
  function large(n:number,ascii:number):Record<string,unknown>|null {
    const entries=Array.from({length:5},(_,i)=>({reference:String(i)+long.slice(2),recordType:long,revision:long,eligibility:'OWNER_SELECTED',topics:Array.from({length:30},(_,j)=>i<4?'\0'.repeat(100):('\0'.repeat(Math.max(0,Math.min(100,n-j*100)))||'a'))}));
    if(ascii){const index=entries[4].topics.findIndex(t=>t.length+ascii<=100);if(index<0)return null;entries[4].topics[index]+='a'.repeat(ascii);}
    const document=viewSchema.parse({publisherAgentId:'fq-agent-b',name:'synthetic',description:'',topics:[],recordTypes:[long],visibility:'SHARED',allowedAudience:[],mode:'SNAPSHOT',entries,provenancePolicy:'SOURCE_REFERENCES_REQUIRED',expiresAt,expectedVersion:0});
    assert.ok(Buffer.byteLength(canonicalJson(document))<=131072);
    return {...base,capability:'knowledge.query',payload:query,publication:{viewId:base.resource,version:1,visibility:document.visibility,provenancePolicy:document.provenancePolicy,entries:document.entries}};
  }
  for(const target of targets){
    let found:EnvelopeFixture|undefined;
    for(let suffix=0;suffix<3&&!found;suffix++){
      const kid=keyId+'x'.repeat(suffix);let low=0,high=3000;
      while(low<=high){const mid=Math.floor((low+high)/2);if(inputBytes(large(mid,0)!,kid)<=target)low=mid+1;else high=mid-1;}
      for(let n=Math.max(0,high-2);n<=high&&!found;n++)for(let a=0;a<6&&!found;a++){
        const envelope=large(n,a);if(envelope&&inputBytes(envelope,kid)===target)found={name:String(target),envelope,keyId:kid,materialBytes:target};
      }
    }
    assert.ok(found,'Exact schema-valid boundary fixture unavailable');fixtures.push(found);
  }
  for(const {envelope:e} of fixtures){
    const submission={target:qualificationAudience,resource:e.resource,idempotencyKey:e.idempotencyKey,expiresAt,capability:e.capability,payload:e.payload};
    submissionSchema.parse(submission);assert.ok(Buffer.byteLength(canonicalJson(submission))<=131072);
  }
  return fixtures;
}
