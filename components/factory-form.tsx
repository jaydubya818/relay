"use client";
import { useState } from "react";
import type { HostedResult } from "@/lib/myfactory-protocol.mjs";

export function FactoryForm({ configured }: { configured: boolean }) {
  const [result,setResult]=useState<HostedResult|null>(null), [busy,setBusy]=useState(false), [error,setError]=useState<string|null>(null);
  const [key]=useState(()=>crypto.randomUUID());
  async function request(operation:"create"|"read",input:unknown){
    setBusy(true);setError(null);
    try {const response=await fetch("/api/v2/operator/factory",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({operation,input})});const body=await response.json();if(!response.ok)throw Error(body.message??body.error??"The request could not be confirmed.");setResult(body);}
    catch(e){setError(e instanceof Error?e.message:"Request failed");}finally{setBusy(false);}
  }
  return <section className="card">
    {!configured&&<p className="notice">MyFactory routing is not configured for this account yet.</p>}
    <form onSubmit={event=>{event.preventDefault();const data=new FormData(event.currentTarget);void request("create",{idempotencyKey:key,title:data.get("title"),description:data.get("description"),kind:"feature",acceptanceCriteria:String(data.get("criteria")).split("\n").filter(Boolean),allowedPaths:String(data.get("paths")).split("\n").filter(Boolean)});}}>
      <label>Title<input name="title" required maxLength={200}/></label>
      <label>Description<textarea name="description" required maxLength={12000}/></label>
      <label>Acceptance criteria<textarea name="criteria" required placeholder="One criterion per line"/></label>
      <label>Permitted repository paths<textarea name="paths" required placeholder="docs/"/></label>
      <button className="button primary" disabled={!configured||busy||!!result}>{busy?"Checking…":"Send to MyFactory"}</button>
    </form>
    {error&&<p className="notice error" role="alert">{error}</p>}
    {result&&<div className="section-gap" role="status"><h2>{result.receipt?"Received by local factory":"Waiting for the local factory"}</h2>
      <p><a href={result.issueUrl} target="_blank" rel="noreferrer">{result.issueIdentifier} in Linear ↗</a></p>
      {result.receipt?<p>WorkOrder <a href={result.receipt.workOrderUrl}>{result.receipt.workOrderId}</a> · {result.receipt.state}. Execution and review continue in MyFactory.</p>:<p>The signed request is saved. The Mac will receive it when MyFactory is online.</p>}
      <button className="button" disabled={busy} onClick={()=>void request("read",{requestId:result.requestId})}>Check factory receipt</button>
    </div>}
  </section>;
}
