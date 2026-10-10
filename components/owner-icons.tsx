export function OwnerIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    Home: "M3 10 12 3l9 7v10H3Z M9 20v-7h6v7", Agents: "M8 4h8v4H8Z M5 8h14v12H5Z M9 12v2 M15 12v2 M9 17h6 M12 2v2",
    Connections: "m8 8 3-3a5 5 0 0 1 7 7l-3 3 M16 16l-3 3a5 5 0 0 1-7-7l3-3 M9 15l6-6",
    Activity: "M3 12h4l3-8 4 16 3-8h4", Settings: "M4 7h16 M4 17h16 M8 4v6 M16 14v6",
    Advanced: "m8 6-6 6 6 6 M16 6l6 6-6 6 M14 3l-4 18", Arrow: "M5 12h14 m-6-6 6 6-6 6",
  };
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.Agents} /></svg>;
}
