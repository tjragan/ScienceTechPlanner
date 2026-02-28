# Science Tech Planner

A lightweight web app that converts teacher requests for lab practicals and demos into a printable list of equipment and reagents to be delivered to each classroom.

## Features

- **Single-user JWT authentication** – first-time password setup, then login with a hashed password (PBKDF2 + HMAC-SHA-256 JWT, no external dependencies)
- **Teachers** – maintain a list of teachers
- **Rooms** – rooms with a standing equipment inventory (items already in the room are deducted from the delivery list automatically)
- **Schedule** – map each teacher to a room, day and period; record student counts
- **Experiments** – define experiments with equipment and reagent requirements (`quantity_per_class` + `quantity_per_student`)
  - **Teacher variances** – long-term per-teacher modifications to an experiment's requirements
  - **Notes** – free-text notes on any experiment
- **Practical requests** – assign an experiment to a schedule slot on a specific date
  - **One-time overrides** – modify equipment/reagents for a single request
- **Delivery report** – printable, period-by-period breakdown of what needs to be delivered to each room, showing items already in the room and the net quantity to deliver

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Hosting | Cloudflare Pages |
| API | Cloudflare Pages Functions (Workers) |
| Database | Cloudflare D1 (SQLite) |
| Auth | JWT (HS256) + PBKDF2 password hashing via Web Crypto API |
| Frontend | Bootstrap 5 + Vanilla JS (no build step) |

## Setup

### Prerequisites
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) (`npm install -g wrangler`)
- A Cloudflare account with Pages and D1 enabled

### Deploy

```bash
# 1. Install dev dependencies
npm install

# 2. Create the D1 database
wrangler d1 create science-tech-planner
# Copy the database_id into wrangler.toml

# 3. Apply the schema
npm run db:init

# 4. Deploy to Cloudflare Pages
npm run deploy
```

### Local development

```bash
# Apply schema locally
npm run db:init:local

# Start dev server (uses local D1)
npm run dev
```

The app will be available at `http://localhost:8788`.  
On first visit you will be prompted to create a password.

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `JWT_SECRET` | Secret used to sign JWTs. Set this in the Cloudflare Pages dashboard. | Recommended (falls back to a dev default) |

## Project Structure

```
.
├── functions/
│   └── api/
│       └── [[route]].js   # All API routes (Cloudflare Pages Function)
├── public/
│   ├── index.html         # Single-page application
│   ├── app.js             # Frontend JavaScript
│   └── style.css          # Custom styles
├── schema.sql             # D1 database schema
└── wrangler.toml          # Cloudflare configuration
```
