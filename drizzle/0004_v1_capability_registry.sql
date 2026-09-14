INSERT INTO "capabilities" ("id", "name", "version", "domain", "description", "risk", "provider", "input_schema", "output_schema") VALUES
  ('cap_agent_inbox_list', 'agent.inbox.list', '1.0', 'AGENT_INBOX', 'List durable events routed to the Agent.', 'LOW', NULL, '{}', '{}'),
  ('cap_agent_inbox_get', 'agent.inbox.get', '1.0', 'AGENT_INBOX', 'Read one durable event routed to the Agent.', 'LOW', NULL, '{}', '{}'),
  ('cap_agent_inbox_ack', 'agent.inbox.ack', '1.0', 'AGENT_INBOX', 'Acknowledge a durable Agent inbox item.', 'MEDIUM', NULL, '{}', '{}'),
  ('cap_capabilities_search', 'capabilities.search', '1.0', 'RELAY', 'Search the active Relay capability registry.', 'LOW', NULL, '{}', '{}')
ON CONFLICT ("name") DO UPDATE SET
  "version" = EXCLUDED."version",
  "domain" = EXCLUDED."domain",
  "description" = EXCLUDED."description",
  "risk" = EXCLUDED."risk",
  "provider" = EXCLUDED."provider",
  "status" = 'ACTIVE',
  "enabled" = true;
