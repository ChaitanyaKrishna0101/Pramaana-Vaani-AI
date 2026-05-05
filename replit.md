# VAANI — AI Voice Assistant for Emergency Dispatch

## Overview

VAANI is a real-time multilingual AI voice assistant built for Indian emergency dispatch (1092). It listens to citizens speaking in Telugu, Kannada, Hindi, or English, analyzes emotion and urgency, and routes calls to the appropriate response level.

## Architecture

**Monorepo (pnpm workspaces):**
- `artifacts/vaani` — React + Vite frontend (`@workspace/vaani`)
- `artifacts/api-server` — Express API server (`@workspace/api-server`)
- `lib/api-spec` — OpenAPI contract (`@workspace/api-spec`)
- `lib/api-client-react` — Generated React Query hooks (`@workspace/api-client-react`)
- `lib/api-zod` — Generated Zod schemas (`@workspace/api-zod`)
- `lib/db` — Drizzle ORM + PostgreSQL (`@workspace/db`)
- `lib/integrations-gemini-ai` — Gemini AI client via Replit integration

## Key Features

- **Voice capture:** MediaRecorder API with silence detection via AudioContext + AnalyserNode
- **Multilingual AI:** Gemini 2.5 Flash processes audio inline (base64), detects language, emotion, urgency, keywords
- **3-Level Escalation:**
  - L1: confidence ≥ 85 + calm → automated response
  - L2: confidence < 85 OR urgency ≥ 6 → human review
  - L3: confidence < 60 OR distressed OR urgency ≥ 8 → immediate human escalation
- **TTS:** Web Speech API speaks responses back in caller's language (en-IN, hi-IN, kn-IN, te-IN)
- **Session memory:** In-process Map for multi-turn conversation
- **Feedback loop:** Correct/Wrong rating stored in PostgreSQL `calls` table
- **Analytics dashboard:** Accuracy, language breakdown, escalation stats, common issues
- **Call history:** Full table of past calls with transcripts

## Pages

- `/` — Main dispatch dashboard (command center)
- `/analytics` — Real-time analytics overview
- `/history` — Call history log

## API Endpoints

All under `/api/vaani/`:
- `POST /process` — Submit audio for AI analysis
- `POST /feedback` — Submit correct/wrong feedback on a call
- `GET /history` — Retrieve past call records
- `GET /analytics` — Retrieve aggregated statistics
- `POST /reset-session` — Clear in-memory session state

## Tech Stack

- React 18 + Vite + TypeScript + Tailwind CSS + shadcn/ui
- Express + Drizzle ORM + PostgreSQL
- Google Gemini 2.5 Flash (via Replit AI Integrations proxy)
- Framer Motion + Lucide React + Recharts
- TanStack Query + Orval codegen
- Wouter for client-side routing

## Environment Secrets

- `SESSION_SECRET` — Express session secret
- `AI_INTEGRATIONS_GEMINI_BASE_URL` — Gemini proxy base URL (auto-set by Replit)
- `AI_INTEGRATIONS_GEMINI_API_KEY` — Gemini API key (auto-set by Replit)
- `DATABASE_URL` — PostgreSQL connection string (auto-set by Replit)

## Database Schema

`calls` table: `id`, `sessionId`, `transcript`, `issue`, `emotion`, `language`, `urgency`, `confidence`, `level`, `keywords[]`, `response`, `feedback`, `createdAt`
