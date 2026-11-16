// The redesign smoke retains independent-source/EntryReuse/build/approval coverage and adds
// modal, library, settings, search, open-state and draft flows. The parent owns server lifetime.
// Required: SMOKE_ORIGIN=http://127.0.0.1:<disposable-port> SMOKE_SYNTHETIC=1.
// Optional real provider turns: SMOKE_HARNESS=pi|codex (may incur cost).
import "./smoke-redesign.ts";
