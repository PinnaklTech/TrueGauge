# TrueGage · Staff Console (Master Admin)

Restricted ops console for TrueGage platform staff (`platform_admin` only).

- **URL:** http://localhost:8081  
- **Customer app:** http://localhost:8080  
- **API:** http://localhost:8000  

## Run

```bash
# from repo root (API must already be up)
npm run dev:admin
```

Or:

```bash
cd master-admin
npm install
npm run dev
```

## Sign in

Requires:

1. A `platform_admin` account  
2. Password  
3. Shared **6-digit staff passcode** (`MASTER_ADMIN_PASSCODE` in API `.env`)

Workspace / org users are rejected — they must use the customer app.

Local default passcode if unset: `000000` (never use this in production).

## Features

- **Command Center** — KPIs, charts, attention strip (suspended, failed welcomes, missing SMTP, auth failures)  
- **Companies** — search/filter, onboard + required company admin + welcome email  
- **Company cockpit** (`/companies/:id`) — tabbed ops workspace:
  - Overview (health + onboarding checklist)
  - Members (create, edit role, enable/disable, force password, revoke sessions, welcome email)
  - Org profile (staff-editable)
  - Integrations (SMTP/Odoo status, no secrets)
  - Email history + resend welcome
  - Fleet (read-only equipment)
  - Activity (company timeline)
  - Open workspace (handoff) / Suspend  
- **Users** — cross-tenant directory grouped by company  
- **Staff** — create / edit name / reset password / enable-disable platform admins  
- **Email** — platform-wide email queue with status/kind filters  
- **Activity** — categorized + grouped by company  
- **Data** — read-only browser of live DB tables (secrets redacted)  

## Platform SMTP (onboarding emails)

Set these on the API so onboarding can email the new company admin from TrueGage:

```
SYSTEM_SMTP_HOST=
SYSTEM_SMTP_PORT=587
SYSTEM_SMTP_USERNAME=
SYSTEM_SMTP_PASSWORD=
SYSTEM_SMTP_FROM_EMAIL=
SYSTEM_SMTP_FROM_NAME=TrueGage
SYSTEM_SMTP_USE_TLS=true
```

Without them, companies still onboard; welcome email is logged as failed/skipped.
