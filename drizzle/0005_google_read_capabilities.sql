INSERT INTO "capabilities" ("id", "name", "version", "domain", "description", "risk", "provider", "input_schema", "output_schema") VALUES
  ('cap_email_search_v1', 'email.search', '1.0', 'EMAIL', 'Search authorized Gmail messages.', 'MEDIUM', 'GOOGLE', '{}', '{}'),
  ('cap_email_read_v1', 'email.read', '1.0', 'EMAIL', 'Read one authorized Gmail message.', 'MEDIUM', 'GOOGLE', '{}', '{}'),
  ('cap_calendar_event_list_v1', 'calendar.event.list', '1.0', 'CALENDAR', 'List authorized Google Calendar events.', 'LOW', 'GOOGLE', '{}', '{}'),
  ('cap_calendar_event_read_v1', 'calendar.event.read', '1.0', 'CALENDAR', 'Read one authorized Google Calendar event.', 'LOW', 'GOOGLE', '{}', '{}'),
  ('cap_calendar_availability_read_v1', 'calendar.availability.read', '1.0', 'CALENDAR', 'Read authorized Google Calendar availability.', 'LOW', 'GOOGLE', '{}', '{}')
ON CONFLICT ("name") DO UPDATE SET "version" = EXCLUDED."version", "domain" = EXCLUDED."domain", "description" = EXCLUDED."description", "risk" = EXCLUDED."risk", "provider" = EXCLUDED."provider", "enabled" = true, "status" = 'ACTIVE';
