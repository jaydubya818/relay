"use client";
export default function ErrorPage({ reset }: { reset: () => void }) { return <section className="card" role="alert"><h1>Integrations unavailable</h1><p>Owner access is required. If you are the owner, try again or contact your administrator.</p><button className="button secondary" onClick={reset}>Try again</button></section>; }
