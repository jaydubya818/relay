"use client";
import Link from "next/link";
export default function DashboardError({ reset }: { reset: () => void }) {
  return <section className="card" role="alert"><h1>This page could not be loaded</h1><p>Relay could not retrieve the latest information. Try again, or return Home.</p><div className="owner-actions"><button className="button" onClick={reset}>Try again</button><Link className="text-link" href="/">Return Home</Link></div></section>;
}
