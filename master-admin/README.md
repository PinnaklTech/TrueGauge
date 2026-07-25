# True Gauge · Master Admin

Standalone control center for True Gauge platform admins (`platform_admin`).

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

Sign in with a `platform_admin` account (e.g. `admin@truegauge.com`).

## Features (v1)

- Overview KPIs across your companies
- List / create / rename / activate companies
- **Open company** — switches into the customer app via `/auth/handoff`
