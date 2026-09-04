# Watched Logger

Watched Logger is an installable web app for tracking films and television episodes, including release reminders and cross-device library syncing.

## What each project item is for

| Path | Purpose |
| --- | --- |
| `index.html` | The complete website interface and browser-side app logic. GitHub Pages requires this conventional entry-point name. |
| `manifest.webmanifest` | Installation details used when the site is added to a phone or computer as an app. |
| `sw.js` | The service worker that receives and displays episode-release notifications. Its short conventional name is referenced by the app. |
| `.github/workflows/pages.yml` | Publishes the website to GitHub Pages using Node.js 24-compatible GitHub Actions. |
| `supabase/functions/watchlog-pin/` | Handles secure PIN access, library syncing, and maintenance-mode checks. The directory name is also the function's public endpoint name. |
| `supabase/functions/watchlog-reminders/` | Stores notification subscriptions and sends scheduled episode reminders. The directory name is also the function's public endpoint name. |
| `supabase/migrations/` | Records database changes needed to reproduce the backend safely, including maintenance-mode support. |

## Repository layout

```text
Watched-Tracker/
├── .github/
│   └── workflows/
│       └── pages.yml
├── supabase/
│   ├── functions/
│   │   ├── watchlog-pin/
│   │   │   └── index.ts
│   │   └── watchlog-reminders/
│   │       └── index.ts
│   └── migrations/
│       └── 20260903_add_watchlog_maintenance_mode.sql
├── index.html
├── manifest.webmanifest
└── sw.js
```

Every tracked file is part of the running app, its deployment, or the reproducible backend. There are no generated build folders, dependency folders, or obsolete duplicate files committed to the repository.

## Deployment

Changes pushed to `main` are automatically deployed to GitHub Pages. The Supabase functions and migrations are backend components and are deployed through Supabase separately.
