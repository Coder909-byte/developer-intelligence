# Local security boundaries

Daemon binds IPv4 loopback only and checks Host/Origin. All actual non-health requests require a bearer token; allowed-origin CORS preflight is unauthenticated. Generated token and SQLite live under the ignored private data directory. Environment tokens must contain at least 32 characters. Structured request logs omit authorization, body and query values. SDK refuses non-loopback origins, URL credentials and HTTP redirects.

Project registration canonicalizes an absolute existing directory. It does not execute commands or read arbitrary project content. Future runners must authorize each canonical artifact path, including symlinks, against that project. Tool commands need a fixed executable/argument policy, deadlines, cancellation and bounded captured output. MCP server configuration must not inline secrets in inventory responses.

No path writes, config applies, firmware flashing, telemetry collection or agent-session scraping are implemented. Before adding them, implement the explicit permission and rollback rules in TECHNICAL_SPEC. Local token protection does not defend against an already-compromised OS user account.
