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

Or individually:
```bash
npm run dev:ui
npm run dev:bot
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
