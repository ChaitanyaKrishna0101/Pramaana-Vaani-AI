# PRAMAANA VAANI AI
## AI-Powered Multilingual Emergency Dispatch Assistant for Indian Public Safety Systems

<p align="center">
  <img src="https://img.shields.io/badge/AI-Gemini%202.5-blue?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Frontend-React%20%2B%20TS-61DAFB?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Backend-Express.js-black?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Database-PostgreSQL-336791?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Status-Production%20Architecture-success?style=for-the-badge" />
</p>

---

# Problem Statement

Emergency helplines in India face major operational challenges:

- Language barriers between callers and operators
- Panic-driven communication failures
- Delayed human response during high call volume
- Lack of intelligent prioritization
- Manual triaging inefficiencies
- Limited multilingual support
- No emotion-aware escalation systems

Traditional IVR systems are rule-based and incapable of understanding:
- emotional distress
- urgency
- contextual intent
- multilingual speech patterns

This creates dangerous delays during emergencies.

---

# Solution

VAANI is an AI-powered multilingual emergency dispatch assistant that performs:

- Real-time voice interaction
- Language detection
- Emotion analysis
- Urgency scoring
- AI-generated multilingual responses
- Smart escalation routing
- Human handoff prioritization

The system acts as an intelligent first-response layer before human intervention.

---

# Core Idea

Instead of forcing distressed callers through static IVR menus:

VAANI behaves like an AI emergency operator.

It:
1. Listens to the caller
2. Understands their language
3. Detects emotional distress
4. Determines urgency level
5. Responds naturally
6. Escalates critical calls instantly

---

# Real-World Scenario

## Example

Caller speaks in Telugu:

> "నా ఫ్రెండ్‌ని కొడుతున్నారు... త్వరగా సహాయం పంపండి..."

VAANI:
- Detects Telugu
- Detects panic/distress
- Extracts assault-related keywords
- Assigns urgency score
- Escalates to Level 3
- Immediately routes to human responders

This entire pipeline executes within seconds.

---

# Key Features

## Multilingual Voice AI
Supports:
- Telugu
- Kannada
- Hindi
- English

---

## Emotion Detection
Detects:
- panic
- fear
- distress
- calmness
- urgency indicators

---

## Smart Escalation Engine

| Level | Logic | Action |
|---|---|---|
| L1 | Calm + High confidence | AI handles call |
| L2 | Moderate urgency | Human review |
| L3 | High distress or critical urgency | Immediate escalation |

---

## Session Memory
Maintains conversational continuity across multiple turns.

---

## Analytics Dashboard
Tracks:
- escalation metrics
- language distribution
- AI accuracy
- emergency categories
- operator feedback

---

# System Architecture

```text
Citizen Call
     ↓
Voice Capture Layer
(MediaRecorder API)
     ↓
Audio Processing
(Silence Detection)
     ↓
Express API Server
     ↓
Gemini AI Processing
     ↓
Intent + Emotion + Language Analysis
     ↓
Escalation Decision Engine
     ↓
AI Response OR Human Escalation
     ↓
PostgreSQL Storage
     ↓
Analytics Dashboard
```

---

# User Data Flow

```text
User Speaks
   ↓
Frontend Captures Audio
   ↓
Audio Converted to Base64
   ↓
Sent to /api/vaani/process
   ↓
Gemini AI Analyzes:
   - Language
   - Emotion
   - Urgency
   - Keywords
   - Intent
   ↓
Backend Determines Escalation Level
   ↓
AI Generates Response
   ↓
Frontend Speaks Response via TTS
   ↓
Call Data Stored in PostgreSQL
   ↓
Analytics Updated
```

---

# Monorepo Architecture

```bash
artifacts/
├── vaani/                 # React Frontend
├── api-server/            # Express Backend

lib/
├── api-spec/              # OpenAPI Contracts
├── api-client-react/      # Generated React Hooks
├── api-zod/               # Runtime Validation
├── db/                    # Drizzle ORM + PostgreSQL
├── integrations-gemini-ai # Gemini AI Client
```

---

# Frontend Stack

- React 18
- TypeScript
- Vite
- Tailwind CSS
- shadcn/ui
- Framer Motion
- TanStack Query
- Wouter
- Recharts

---

# Backend Stack

- Express.js
- Drizzle ORM
- PostgreSQL
- Gemini 2.5 Flash
- REST API
- Session Memory Store

---

# AI Processing Pipeline

## Input
Voice Audio

## AI Analysis
- Speech understanding
- Emotion classification
- Intent extraction
- Language detection
- Urgency scoring

## Output
Structured emergency response object.

Example:

```json
{
  "language": "Telugu",
  "emotion": "Distressed",
  "urgency": 9,
  "confidence": 92,
  "level": "L3",
  "keywords": ["assault", "help"],
  "response": "మేము సహాయం పంపిస్తున్నాము."
}
```

---

# Database Schema

## calls table

| Column | Type |
|---|---|
| id | UUID |
| sessionId | String |
| transcript | Text |
| issue | Text |
| emotion | String |
| language | String |
| urgency | Integer |
| confidence | Integer |
| level | String |
| keywords | String[] |
| response | Text |
| feedback | String |
| createdAt | Timestamp |

---

# API Endpoints

```http
POST   /api/vaani/process
POST   /api/vaani/feedback
GET    /api/vaani/history
GET    /api/vaani/analytics
POST   /api/vaani/reset-session
```

---

# Pages

| Route | Description |
|---|---|
| / | Emergency dispatch dashboard |
| /analytics | Real-time analytics |
| /history | Historical call logs |

---

# Local Development Setup

# Prerequisites

Install:

- Node.js 18+
- pnpm
- PostgreSQL
- Google AI Studio API Key

---

# Step 1 — Clone Repository

```bash
git clone <your-repository-url>
cd <repository-folder>
```

---

# Step 2 — Install Dependencies

```bash
pnpm install
```

---

# Step 3 — Configure Environment Variables

## Backend

Create:

```bash
artifacts/api-server/.env
```

Add:

```env
PORT=8080
DATABASE_URL=postgresql://user:password@localhost:5432/vaani
SESSION_SECRET=replace-with-random-secret
AI_INTEGRATIONS_GEMINI_API_KEY=your_google_ai_key
AI_INTEGRATIONS_GEMINI_BASE_URL=https://generativelanguage.googleapis.com
NODE_ENV=development
```

---

## Frontend

Create:

```bash
artifacts/vaani/.env
```

Add:

```env
PORT=5173
BASE_PATH=/
```

---

# Step 4 — Configure Local Proxy

Open:

```bash
artifacts/vaani/vite.config.ts
```

Add:

```ts
server: {
  port,
  strictPort: true,
  host: "0.0.0.0",
  allowedHosts: true,
  proxy: {
    "/api": "http://localhost:8080",
  },
  fs: { strict: true },
},
```

---

# Step 5 — Setup Database

```bash
pnpm --filter @workspace/db run push
```

This creates the required PostgreSQL tables.

---

# Step 6 — Run Backend

```bash
pnpm --filter @workspace/api-server run dev
```

---

# Step 7 — Run Frontend

```bash
pnpm --filter @workspace/vaani run dev
```

---

# Step 8 — Open Application

```bash
http://localhost:5173
```

---

# Technical Highlights

- Real-time multilingual AI voice processing
- Emotion-aware escalation engine
- Production-grade monorepo architecture
- AI-assisted emergency triaging
- Full-stack TypeScript ecosystem
- Analytics-driven operational monitoring
- Structured API contracts with OpenAPI
- Runtime validation using Zod

---

# Scalability Vision

Future production upgrades:

- Twilio telephony integration
- WebRTC streaming
- Kubernetes deployment
- Redis session storage
- Kafka event streaming
- GPU inference pipeline
- Voice biometrics
- Regional language expansion
- Offline speech recognition

---

# Security Considerations

- Environment secret isolation
- API validation layer
- Server-side AI key protection
- ORM-based DB safety
- Controlled escalation logic
- Session isolation

---

# Impact

VAANI aims to reduce emergency response latency by enabling intelligent multilingual AI triaging for Indian public safety systems.

The system bridges communication gaps between distressed citizens and emergency responders using conversational AI.

---

# Author

## Emmadi Chaitanya Krishna , Sagar 

MCA Student • AI/ML Enthusiast • Full Stack Developer

---
