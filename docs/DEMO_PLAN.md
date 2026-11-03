# Demo plan

Bootstrap proof: `pnpm smoke` checks real HTTP health, generated token reuse, authenticated project create/list/get/update/delete, SQLite persistence after process restart, and a truthful context 501 response. Start `pnpm dev`, check connection in browser, build extension and press F5 to exercise the native health command once VS Code is installed.

Product demo gates still to implement: deterministic KiCad/firmware discrepancy → VS Code finding → reviewed correction → genuine validation result persisted → MCP retrieval from a verified second host → matching desktop state. Follow PRD's five-minute narrative only after these work. Label fixtures and unavailable tools clearly; do not claim firmware build, MCP interoperability, native Tauri packaging or extension runtime validation from bootstrap tests alone.

Developer 2 supplies source-attributed example artifacts; Developer 3 supplies diagnostics/interaction; Developer 1 integrates persistence/routes/SDK and verifies the full flow. Keep hardware and RTL stretch work behind the P0 path.
