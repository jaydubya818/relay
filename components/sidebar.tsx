import Link from "next/link";

const groups = [
  { label: "Plane", links: [["◫", "Overview", "/"], ["◉", "Agents", "/agents"], ["⌁", "Activity", "/activity"]] },
  { label: "Capabilities", links: [["◇", "Memory", "/memory"], ["⎋", "Connections", "/connections"], ["▣", "Sandboxes", "/sandboxes"], ["◎", "Browsers", "/browsers"], ["↳", "Events", "/events"]] },
  { label: "Developer", links: [["⌘", "MCP", "/developer"]] },
  { label: "Control", links: [["⚙", "Settings", "/settings"]] },
];

export function Sidebar() {
  return (
    <aside className="sidebar">
      <Link className="brand" href="/"><span className="brand-mark">R</span><span>RELAY</span></Link>
      <nav>
        {groups.map((group) => (
          <div className="nav-group" key={group.label}>
            <div className="nav-label">{group.label}</div>
            {group.links.map(([icon, label, href]) => (
              <Link className="nav-link" href={href} key={href}><span className="nav-icon">{icon}</span><span>{label}</span></Link>
            ))}
          </div>
        ))}
      </nav>
      <div className="sidebar-foot">Relay V1<br />Capability plane</div>
    </aside>
  );
}
