# Development

## Prereqs
- Node.js + npm

## Install
```bash
npm install
```

## Configure
Create a `.env` in repo root.

Minimum for Telegram:
```env
TELEGRAM_BOT_TOKEN=...
OPENAI_API_KEY=...
```

## Run
Run Web UI + Telegram bot together:
```bash
npm run dev
```

Run Web UI + Telegram bot + live delegation/tool/workflow lineage tail:
```bash
npm run dev:trace
```

This defaults to high-signal delegation and workflow events so telemetry polling does not flood the console.

Or individually:
```bash
npm run dev:ui
npm run dev:bot
```

If you only want the live lineage tail:
```bash
npm run dev:trace:tail
```

If you need low-level `extension.execute` checkpoints as well:
```bash
npm run dev:trace:tail:verbose
```

## Tests
```bash
npm test
```

Boundary checks (monorepo import rules):
```bash
npm run check:boundaries
```

## Repo conventions
- Prefer package exports over cross-package `src/` imports.
- New features should include:
  - contract definitions
  - middleware enforcement points
  - tests
  - doc updates (this folder)
