# CareThread - Clinical Digital Twin System

A hospital operations platform built around five clinical modules, powered by Azure Digital Twins Definition Language (DTDL v3) models and synthetic FHIR R4 patient data.

## Modules

| Module | Description |
|--------|-------------|
| **PFO** - Patient Flow Optimizer | Real-time bed occupancy, ER surge detection, bed allocation, demand forecasting, ER queue, discharge workflow, patient transfers, bed turnaround tracking |
| **CEWS** - Clinical Early Warning System | NEWS2 scoring, deterioration prediction, vitals trend charts, tiered alert escalation |
| **PEM** - Predictive Equipment Maintenance | Asset health monitoring, failure probability, calibration tracking, maintenance work orders |
| **ISSA** - Staff Scheduling Assistant | Workload balancing, skill-gap analysis, EU WTD compliance, understaffing prediction, SBAR handoff notes |
| **WISE** - What-If Simulation Engine | Discrete-event simulation, scenario templates (flu surge, mass casualty, ward expansion), comparison dashboard |
| **Sandbox** | Create/discharge patients, add/remove staff & assets, trigger events (equipment failure, ER surge, patient spikes), reset to defaults |

## Hospital Health Score

A real-time composite score (0-100) is always visible in the header, computed from 6 weighted factors:

- **Bed Occupancy** (20%) - ward-level bed utilization
- **Patient Acuity** (25%) - average NEWS2 scores
- **Alert Load** (15%) - unacknowledged alerts weighted by severity
- **Staff Wellbeing** (15%) - average fatigue index
- **Equipment Health** (15%) - average asset health scores
- **ER Status** (10%) - surge detection and arrival rates

Click the score badge to see a detailed breakdown showing which factors are dragging the score down. Grades: A (90+), B (75+), C (60+), D (40+), F (<40).

## Tech Stack

- **Server:** Node.js, Express, TypeScript, WebSocket (ws)
- **Web:** React 18, Vite, TypeScript
- **Data:** Synthetic FHIR R4 bundles, in-memory store with operational seed data
- **Auth:** JWT (HMAC-SHA256) with 7 RBAC roles (disabled by default for demo)
- **DTDL:** 10 Azure Digital Twins v3 model definitions
- **Database:** PostgreSQL 16 via Prisma (schema ready, not yet wired)

## Prerequisites

- **Node.js** >= 18
- **npm** >= 9 (ships with Node 18+)
- **Docker** (optional, for PostgreSQL)

## Quick Start

### One command (recommended)

```bash
npm run start
```

This installs dependencies and starts both the API server and web UI concurrently.

### Manual steps

```bash
# 1. Install all dependencies (root + server + web workspaces)
npm install

# 2. Start both server and web in parallel
npm run dev
```

### Individual services

```bash
# Server only (port 3001)
npm run dev -w server

# Web only (port 5173)
npm run dev -w web
```

## Access

| Service | URL |
|---------|-----|
| Web UI | http://localhost:5173 |
| REST API | http://localhost:3001/api/v1 |
| WebSocket | ws://localhost:3001/ws |

## API Endpoints

### Patient Flow (PFO)
- `GET /api/v1/twins/rooms` - All rooms with bed occupancy
- `GET /api/v1/twins/rooms/:roomId/forecast` - 2h/4h/8h occupancy forecast
- `GET /api/v1/er/surge` - ER surge status and projected shortages
- `POST /api/v1/beds/suggest` - Bed allocation recommendations
- `POST /api/v1/alerts/discharge` - Create discharge readiness alert

### Clinical Early Warning (CEWS)
- `GET /api/v1/twins/patients/:id/vitals` - Current vital signs
- `GET /api/v1/twins/patients/:id/vitals/history?hours=24` - Vitals history
- `GET /api/v1/twins/patients/:id/cews` - NEWS2 score and risk factors
- `GET /api/v1/alerts` - All alerts (sorted by time)
- `POST /api/v1/alerts/:id/acknowledge` - Acknowledge an alert
- `GET /api/v1/alerts/fatigue` - Alert-to-action ratios per ward

### Equipment Maintenance (PEM)
- `GET /api/v1/twins/assets` - All devices with calibration status
- `GET /api/v1/twins/assets/:id/health` - Device telemetry
- `POST /api/v1/assets/:id/maintenance` - Schedule maintenance work order

### Staff Scheduling (ISSA)
- `GET /api/v1/twins/staff` - Staff with workload and fatigue scores
- `GET /api/v1/scheduling/recommendations` - Rebalancing + skill gaps
- `POST /api/v1/scheduling/schedules` - Create schedule with compliance check
- `GET /api/v1/scheduling/understaffing` - Understaffing predictions
- `GET /api/v1/scheduling/skill-gaps` - Skill coverage gaps

### Simulation (WISE)
- `POST /api/v1/simulations/scenarios` - Create and run scenario
- `GET /api/v1/simulations/scenarios/:id/results` - Scenario results
- `GET /api/v1/simulations/scenarios/compare?ids=a,b,c` - Compare up to 4
- `GET /api/v1/simulations/templates` - Preset scenario templates
- `GET /api/v1/simulations/history` - All past simulation runs

### Hospital Health Score
- `GET /api/v1/hospital/health-score` - Composite score + 6 factor breakdown

### Sandbox
- `POST /api/v1/sandbox/patients` - Create a patient (name, age, acuity, ward, room, bed)
- `DELETE /api/v1/sandbox/patients/:id` - Discharge a patient
- `PUT /api/v1/sandbox/patients/:id/deteriorate` - Force patient deterioration
- `POST /api/v1/sandbox/staff` - Add staff member
- `DELETE /api/v1/sandbox/staff/:id` - Remove staff
- `PUT /api/v1/sandbox/staff/:id` - Update staff assignment
- `POST /api/v1/sandbox/assets` - Add equipment
- `PUT /api/v1/sandbox/assets/:id` - Update asset health
- `DELETE /api/v1/sandbox/assets/:id` - Remove equipment
- `PUT /api/v1/sandbox/er-metrics` - Adjust ER arrival/surge params
- `POST /api/v1/sandbox/events/equipment-failure` - Trigger device failure
- `POST /api/v1/sandbox/events/patient-spike` - Admit N patients at once
- `POST /api/v1/sandbox/events/surge` - Force ER surge
- `POST /api/v1/sandbox/reset` - Reset all state to defaults

### Discharge Workflow
- `POST /api/v1/discharge/initiate` - Start discharge with 6-item checklist
- `GET /api/v1/discharge/active` - Active discharge workflows
- `PUT /api/v1/discharge/:id/checklist/:itemId` - Toggle checklist item
- `PUT /api/v1/discharge/:id/complete` - Complete discharge and free bed

### Patient Transfer
- `POST /api/v1/transfers/initiate` - Start inter-ward transfer
- `PUT /api/v1/transfers/:id/complete` - Execute transfer
- `GET /api/v1/transfers/active` - Pending transfers

### ER Queue
- `GET /api/v1/er/queue` - Current queue with wait times
- `POST /api/v1/er/queue` - Add patient to ER queue (ESI 1-5 triage)
- `PUT /api/v1/er/queue/:id/status` - Update queue entry status

### Handoff Notes (SBAR)
- `POST /api/v1/handoffs` - Create SBAR handoff note
- `GET /api/v1/handoffs/:patientId` - Get handoff notes for patient

### Bed Turnaround
- `GET /api/v1/beds/turnaround` - Active turnarounds + avg time
- `PUT /api/v1/beds/turnaround/:id/cleaning-started` - Mark cleaning started
- `PUT /api/v1/beds/turnaround/:id/ready` - Mark bed ready

### Auth & System
- `POST /api/v1/auth/login` - Get JWT token
- `GET /api/v1/auth/demo-users` - List demo credentials
- `GET /api/v1/dtdl/models` - List all DTDL model interfaces
- `GET /api/v1/demo/ehr/summary` - FHIR data summary

## Authentication

Auth is **disabled by default** (`AUTH_DISABLED=true` in `server/.env`). All requests are treated as an Administrator.

To enable auth, set `AUTH_DISABLED=false` in `server/.env` and use JWT tokens:

```bash
# Get a token
curl -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"doctor@carethread.local","password":"doctor123"}'

# Use the token
curl http://localhost:3001/api/v1/twins/rooms \
  -H "Authorization: Bearer <token>"
```

### Demo Users

| Email | Password | Role |
|-------|----------|------|
| admin@carethread.local | admin123 | Administrator |
| doctor@carethread.local | doctor123 | Clinician |
| nurse@carethread.local | nurse123 | Nurse |
| tech@carethread.local | tech123 | EquipmentTechnician |
| pharmacist@carethread.local | pharm123 | Pharmacist |
| sysadmin@carethread.local | sysadmin123 | SystemAdmin |
| planner@carethread.local | planner123 | HospitalPlanner |

## WebSocket Topics

Connect to `ws://localhost:3001/ws?topic=<topic>`:

| Topic | Params | Data |
|-------|--------|------|
| `vitals` | `patientId=pat-1001` | Heart rate, BP, SpO2, RR, temp, CEWS score |
| `alerts` | - | Active unacknowledged alerts |
| `occupancy` | - | Ward bed counts |
| `assets` | `assetId=dev-001` | Device health and error rate |
| `hospital-health` | - | Real-time hospital health score + factor breakdown |

## DTDL Models

10 Azure Digital Twins v3 definitions in `/dtdl`:

Room, Ward, PatientTwin, Alert, MedicalDevice, MaintenanceWorkOrder, StaffMember, ShiftSchedule, Scenario, SimulationResult

## Project Structure

```
carethread/
  server/               Express API + WebSocket server
    src/
      index.ts          Entry point, WS pub/sub
      api.ts            REST endpoints
      store.ts          In-memory store, simulation engine
      auth/             JWT auth + RBAC
      cews/             NEWS2 algorithm
      fhir/             FHIR R4 data loader
    prisma/
      schema.prisma     PostgreSQL schema (15 models)
  web/                  React 18 + Vite frontend
    src/
      App.tsx           Shell + router
      panels/           Module panels (Pfo, Cews, Pem, Issa, Wise, Sandbox)
      components/       Shared components (HealthScoreBadge)
      api.ts            HTTP + WebSocket helpers
  dtdl/                 DTDL v3 model definitions
  demo-data/            Synthetic FHIR bundles + operational seed
  docker-compose.yml    PostgreSQL 16 for local development
```

## Environment Variables

Set in `server/.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3001 | API server port |
| `AUTH_DISABLED` | true | Skip JWT auth for demo |
| `JWT_SECRET` | carethread-dev-secret... | HMAC signing key |
| `DATABASE_URL` | postgresql://... | PostgreSQL connection (future) |

## Database (Optional)

PostgreSQL is defined in `docker-compose.yml` and a Prisma schema is ready but not yet connected. To prepare:

```bash
docker-compose up -d
cd server && npx prisma migrate dev --name init
```

## License

Internal project - not for clinical use.
