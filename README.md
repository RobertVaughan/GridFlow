# GridFlow (MVP)

A lightweight, extensible web-based visual node editor with PHP persistence.

## Features implemented
- Drag nodes on a snap grid (configurable), DOM nodes + Canvas edges
- Ports, connection validation with adapters, simple cycle guard
- Deterministic topological execution with async support and log streaming
- JSON persistence, autosave, and PHP server endpoints
- Plugin API (`registerNode`, `registerAdapter`, `registerPortType`)
- Undo/redo, keyboard shortcuts, minimap, inspector panel, palette search
- Theming (light/dark/high-contrast), basic a11y and focus rings
- Starter nodes: Start, Add, Concat, Log, HTTP Request
- Tests page

## Run
- Serve the folder via PHP built-in server or any web server:
  ```sh
  php -S 127.0.0.1:8000 -t /path/to/gridflow
  ```
- Visit http://127.0.0.1:8000

## Notes
- Security: API uses strict CSP headers; consider auth (JWT/session) for multi-user.
- Sandbox: user code nodes should execute in Web Workers/isolates (future work).
- Performance: MVP; edges use Canvas, nodes use DOM. Dirty-rect, virtualization possible.
