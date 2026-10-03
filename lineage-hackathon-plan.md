# Lineage — Hackathon Build Plan

**MongoDB × Give(a)Go Student Builder Day · Saturday 3 October 2026 · Dublin**

> *A system that remembers why its code was written, and uses that memory to heal itself.*

---

## 1. The Idea in One Minute

AI coding agents now write a large share of production code. When that code breaks, there is often no human who remembers *why* it was written or *what it assumed*. Traditional self-healing systems only see **what** happened (metrics, logs). They never see **intent**.

Lineage has two halves sharing one MongoDB database:

- **The Notetaker** ("Granola for coding agents") quietly turns coding agent sessions into structured change notes, capturing the intent behind each change and, crucially, the **assumptions** the agent made.
- **The Healer** watches a running service. When something breaks, it asks: *what changed, why, and which assumption did reality just violate?* It proposes a fix, waits for human approval, applies it, and records the lesson.

**The core loop:** coding sessions become memory → incidents query that memory → fixes become new memory → future coding sessions are warned.

**The hero moment for the demo:** the dashboard highlights, in red, the exact assumption a coding agent made days ago that production just violated, with the original session linked as evidence.

---

## 2. Event Constraints We Are Designing Around

| Constraint | What it means for us |
|---|---|
| ~4.5 hours of build time (11:45 → 16:00, minus lunch) | One end-to-end workflow, polished. No sprawling architecture. |
| Submission at 16:00 | Feature freeze at 15:30, submit by 15:45. |
| 3-minute demo, no slide deck | One live, visible, dramatic loop. Rehearse twice. |
| "Give MongoDB a meaningful role" | MongoDB is the link between intent and failure, not just storage. |
| "Understand the code you present" | Every team member can explain both halves at a high level. |
| Start the project at the event, Git repo from the start | Create the repo in the first 15 minutes, commit often from both pairs. |
| Keep private data and credentials out of repos | Shared connection string lives in a local `.env`, never committed. |
| "Test a difficult case" | Planned explicitly (see Section 11). |

---

## 3. How We Score Against the Judging Criteria

All five criteria are equally weighted.

| Criterion | Our angle |
|---|---|
| **Effective use of MongoDB** | Change streams trigger the agent, Vector Search links symptoms to intent, structured queries match numeric assumptions, time-series stores metrics, TTL expires raw transcripts, schema validation and unique indexes protect the shared contract. Each feature has a real job. |
| **Creativity & innovation** | Other teams may build "incident assistants." Our differentiator is **capturing agent assumptions at write time and detecting their violation at run time.** Lead with this. |
| **Functionality & implementation** | One loop that works live, every time, including a graceful failure case. |
| **Impact & usefulness** | Every developer understands the pain of "who changed this and why?" It gets worse as AI writes more code. |
| **Presentation & clarity** | Clear story, one red-highlight moment, MongoDB collections shown at the end. |

---

## 4. Team Structure

Four people, two pairs, one shared database.

### Team Notetaker (2 people)
Owns everything about turning coding sessions into memory.
- Ingesting coding agent transcripts
- Extracting intent and assumptions with an LLM
- Embeddings for change notes
- Letting a user review and correct extracted assumptions
- The "warning for a new session" feature at the end of the loop
- The **Sessions** tab of the UI

### Team Healer (2 people)
Owns everything about the running system and incident response.
- A tiny fake service that emits metrics
- The chaos trigger that causes a failure
- Change stream detection
- Diagnosis via structured matching plus Vector Search
- The approval step and the applied fix
- Recording incidents and lessons
- The **Incidents** tab of the UI

### Shared roles (assign by name in the first 15 minutes)
- **Contract owner:** the only person who approves schema changes. Any change is announced to all four people.
- **Demo owner:** writes the demo script early and runs rehearsals.
- **Repo owner:** creates the repo, sets folder structure, handles merges at integration.

---

## 5. Repository Layout (agreed upfront)

One repository, three top-level areas:

- `notetaker/` — Team Notetaker's ingestion and extraction work
- `healer/` — Team Healer's service, detector and diagnosis work
- `ui/` — one app with two tabs (Sessions, Incidents)
- `setup/` — database setup and seed data (owned by the contract owner)
- `README.md` — problem, architecture, MongoDB features used, how to run
- `.env.example` — variable names only, no secrets

Both pairs commit to their own folder to avoid merge conflicts.

---

## 6. The Shared MongoDB Contract

**One Atlas cluster. One database named `lineage`. One connection string shared privately.**

Each team **owns** (writes to) its collections. The other team only **reads** them. This is what lets both pairs build in parallel.

### 6.1 Collection Ownership

| Collection | Written by | Read by | Purpose |
|---|---|---|---|
| `raw_sessions` | Notetaker | Notetaker | Raw coding agent transcripts, short-lived |
| `change_notes` | Notetaker | Healer, UI | Distilled intent and assumptions per change. **The critical shared collection.** |
| `metrics` | Healer | Healer, UI | Time-series metrics from the fake service |
| `incidents` | Healer | Notetaker, UI | Detected failures, diagnosis, fix, lesson |
| `service_config` | Healer | Healer, UI | Current configuration of the fake service (what the fix changes) |

### 6.2 `change_notes` — fields

| Field | Type | Notes |
|---|---|---|
| `session_id` | string | Link back to the raw session. **Unique index** prevents duplicate ingestion. |
| `team` | string | Scoping field so retrieval stays within the right team. |
| `service` | string | Must use the agreed service names exactly (see 6.7). |
| `created_at` | date | Used to filter "recent changes." |
| `intent` | string | One-sentence purpose of the change. |
| `files` | array of strings | Files touched. |
| `summary` | string | Short human-readable summary. |
| `assumptions` | array of objects | See below. |
| `embedding` | vector | Of intent + summary + assumptions text. |
| `source_excerpt` | string | Short snippet of the transcript, shown as evidence in the UI. |

**Each assumption object:**

| Field | Notes |
|---|---|
| `id` | Short identifier, unique within the note |
| `text` | Human-readable assumption, e.g. "Peak traffic stays under 500 rps" |
| `metric` | Optional. One of the agreed metric names (`rps`, `latency_ms`, `error_rate`) |
| `operator` | Optional. `lt` or `gt` |
| `threshold` | Optional. Number |
| `status` | `active`, `corrected`, or `rejected` (user can fix wrong extractions) |
| `confidence` | LLM confidence, shown in the UI |

**Key design decision:** numeric assumptions carry structured fields so the Healer can find a violated assumption with a precise query. Assumptions that cannot be expressed as a number fall back to Vector Search. This is a strong talking point for judges: *structured queries where precision matters, semantic search where meaning matters.*

### 6.3 `metrics` — fields (time-series collection)

| Field | Notes |
|---|---|
| `ts` | Time field |
| `service` | Meta field |
| `rps` | Requests per second |
| `latency_ms` | p95 latency |
| `error_rate` | 0 to 1 |

Optionally expire old metrics automatically so the demo database stays small.

### 6.4 `incidents` — fields

| Field | Notes |
|---|---|
| `service` | Affected service |
| `started_at` / `resolved_at` | Timestamps |
| `symptom` | Human-readable, e.g. "p95 latency 2400 ms at 1900 rps" |
| `trigger_metrics` | Snapshot of the metrics that triggered detection |
| `matched_note_id` | The change note the Healer linked to (may be empty) |
| `violated_assumption_id` | The specific assumption (may be empty) |
| `match_method` | `structured`, `vector`, or `none` |
| `evidence` | What the Healer showed the user to justify the diagnosis |
| `proposed_action` | The suggested fix |
| `approved_by` / `approved_at` | Human approval record |
| `status` | `detected`, `diagnosed`, `awaiting_approval`, `resolved`, `unexplained` |
| `lesson` | One-sentence lesson for future coding sessions |
| `embedding` | Of symptom + lesson, so future sessions can find it |

### 6.5 `raw_sessions` — fields

| Field | Notes |
|---|---|
| `session_id` | Unique |
| `ingested_at` | **TTL index** on this field: raw transcripts expire, distilled notes stay |
| `content` | Raw transcript text |
| `team` | Scoping |

**Talking point:** this mirrors how human memory works and reduces privacy exposure. We keep the meaning, not the raw logs.

### 6.6 `service_config` — fields

| Field | Notes |
|---|---|
| `service` | Unique |
| `pool_size` | The setting the fix changes |
| `circuit_breaker` | On or off |
| `updated_by` | `human`, `healer`, or `seed` |
| `updated_at` | Timestamp |

### 6.7 Conventions everyone follows

- **Service names:** `checkout`, `inventory`, `payments`. Lowercase, exactly these.
- **Metric names:** `rps`, `latency_ms`, `error_rate`. Exactly these.
- **Team name for the demo:** `payments-team`.
- **Embedding model:** one model for everything, chosen at kickoff. Same model for stored content and queries. Or use MongoDB's automated embedding if supported, so neither team manages it.
- **Timestamps:** always UTC dates, never strings.

### 6.8 Indexes and validation (set up at kickoff)

| Collection | Index / rule | Why |
|---|---|---|
| `change_notes` | Unique on `session_id` | No duplicate ingestion |
| `change_notes` | Compound on `service` + `created_at` | "Recent changes to this service" |
| `change_notes` | Vector Search index on `embedding`, with `service` and `team` as filter fields | Scoped semantic retrieval |
| `change_notes` | Schema validation requiring `service`, `intent`, `assumptions`, `created_at` | Protects the shared contract between teams |
| `incidents` | Vector Search index on `embedding`, with `service` as filter field | Warnings for future sessions |
| `incidents` | Schema validation on `status` values | Keeps the state machine clean |
| `raw_sessions` | TTL on `ingested_at` | Automatic expiry |
| `raw_sessions` | Unique on `session_id` | No duplicates |
| `service_config` | Unique on `service` | One config per service |

---

## 7. Team Notetaker — Detailed Plan

### Goal
Turn a real coding agent session into a validated, searchable change note with explicit assumptions, and later warn a new session using past incidents.

### Steps
1. **Get a real transcript.** Record a short coding agent session (for example in Claude Code or Codex) where the agent changes the checkout service's connection pool. Steer the conversation so the agent states a traffic assumption out loud. Save the transcript.
2. **Ingest it** into `raw_sessions`.
3. **Extract structure with an LLM:** intent, files, summary, and a list of assumptions. For each assumption, ask the model to fill structured fields when the assumption is numeric, plus a confidence score.
4. **Embed and store** the change note in `change_notes`.
5. **Review screen:** the Sessions tab shows the note with its assumptions. The user can mark an assumption as correct, edit it, or reject it. This directly answers the brief's prompt about *how a user corrects a memory.*
6. **Warning feature (end of loop):** when a new session is ingested for a service, search `incidents` by vector similarity (scoped to that service) and show any relevant lessons: "Warning: a past incident shows checkout traffic reaches ~2000 rps."

### Working before integration
Hand-write one fake incident document in the first 30 minutes so the warning feature can be built without waiting for the Healer.

### Done when
- A real transcript becomes a correct change note in MongoDB.
- At least one assumption has structured fields.
- A user can correct or reject an assumption in the UI.
- A new session shows a warning drawn from an incident.

---

## 8. Team Healer — Detailed Plan

### Goal
Detect a failure live, trace it to the violated assumption, fix it with human approval, and record the lesson.

### Steps
1. **Fake service.** A small simulated checkout service that writes metrics to `metrics` every second. Its behaviour depends on `service_config`: if traffic exceeds what the pool size can handle, latency climbs sharply.
2. **Chaos trigger.** A button in the UI that raises simulated traffic from ~300 rps to ~1900 rps.
3. **Detection.** A change stream on `metrics` watches for latency or error rate crossing a threshold. When crossed, it creates an incident with status `detected`. A second listener (or the same process) picks it up and starts diagnosis.
4. **Diagnosis, two layers:**
   - **Structured match first:** find recent change notes for this service whose active assumptions are violated by current metric values (e.g. assumption "rps less than 500," current rps 1900).
   - **Vector Search fallback:** if no structured match, embed the symptom and search `change_notes` scoped to the service and team.
   - Record `match_method` and the `evidence` shown.
5. **Proposal and approval.** The Incidents tab shows the symptom, the matched note, the violated assumption in red, the source excerpt, and a proposed action. Status becomes `awaiting_approval`.
6. **Apply the fix.** On approval, update `service_config` (increase pool size, enable circuit breaker). Metrics recover visibly.
7. **Record the lesson.** Generate a one-sentence lesson, embed it, mark the incident `resolved`.

### Working before integration
Use the hand-written seed change notes from kickoff for all diagnosis work.

### Done when
- Chaos button reliably causes detection within a few seconds.
- The correct assumption is matched and highlighted.
- Approval changes config and metrics recover on screen.
- The incident is stored with a lesson and embedding.
- The "no match" case behaves honestly (see Section 11).

---

## 9. The UI

One simple web app, two tabs, shared header.

**Sessions tab (Notetaker)**
- List of change notes, newest first
- Detail view: intent, files, assumptions with confidence and status, source excerpt
- Controls to confirm, edit, or reject assumptions
- Warning banner when a new session matches a past incident

**Incidents tab (Healer)**
- Live metrics chart for checkout (latency and rps)
- Chaos button
- Incident timeline: detected → diagnosed → awaiting approval → resolved
- Diagnosis card: violated assumption in red, link to the source change note, evidence, match method
- Approve button

**Demo polish (last hour only):** clear visual states, large readable text for the projector, no dead buttons.

---

## 10. Timeline

| Time | Who | What |
|---|---|---|
| 11:00–11:30 | All | Breakfast. Sketch the plan on paper. Pick the embedding approach. |
| 11:30–11:45 | All | Welcome and MongoDB technical guide. Note anything useful (starter templates, automated embedding). |
| **11:45–12:05** | **All four together** | Create repo and folders. Create cluster and `lineage` database. Agree on every name in Section 6.7. Create collections, indexes and validation rules. Insert seed documents (two change notes, one incident, one config). Assign contract, demo and repo owners. |
| 12:05–13:00 | Pairs split | Notetaker: transcript → extraction working. Healer: fake service, metrics, chaos button. |
| 13:00–13:30 | All | Lunch. **Five-minute contract check:** do the documents each side writes still match Section 6? |
| 13:30–14:30 | Pairs split | Notetaker: real note stored, review screen, warning feature. Healer: change stream detection, diagnosis, approval, fix, incident record. |
| **14:30–15:00** | **All four** | **Integration.** Replace seed data with real data. Run the full loop end to end. Fix mismatches. |
| 15:00–15:20 | All | Test the hard case. Polish the UI. Write the README. |
| 15:20–15:30 | Demo owner leads | Rehearsal #1, timed. |
| **15:30** | All | **Feature freeze.** Nothing new from here. |
| 15:30–15:40 | All | Rehearsal #2. Reset demo state. |
| **15:45** | Repo owner | **Submit.** (Deadline 16:00.) |
| 16:15 | All | Demos and judging. |

**If behind at 14:30:** cut the warning feature first, then the assumption-editing controls. Never cut the core loop: chaos → detect → highlight assumption → approve → recover.

---

## 11. Testing and the Hard Case

### Happy path (rehearse until boring)
Real session → change note → chaos → detection → structured match → red highlight → approve → recovery → lesson stored → new session shows warning.

### The hard case: an unexplained incident
Trigger a failure that no recorded assumption explains (for example, raise the error rate without raising traffic). The Healer should:
- Try structured matching, find nothing
- Try Vector Search, find only weak matches below a similarity threshold
- Mark the incident `unexplained` and say so honestly, showing what it checked
- Still offer a safe generic mitigation (circuit breaker) with approval

**Why this matters:** judges value systems that know what they don't know. It also shows evidence-checking, which the brief explicitly calls out.

### Other checks
- Ingesting the same session twice is rejected by the unique index.
- An invalid change note (missing `service`) is rejected by schema validation.
- A rejected assumption is never matched by the Healer.
- Retrieval never returns notes from another team.

---

## 12. Demo Script (3 minutes)

| Time | Beat | What's on screen | What we say |
|---|---|---|---|
| 0:00–0:20 | Problem | Title only | "AI agents write more of our code every day. When it breaks, nobody remembers why it was written or what it assumed." |
| 0:20–0:50 | Capture | Sessions tab: a real coding session turned into a change note | "Lineage listens to coding agent sessions and pulls out intent and assumptions. Here the agent assumed checkout traffic stays under 500 rps." |
| 0:50–1:10 | Break | Incidents tab, press chaos button, latency climbs | "A week later, a sale hits. Traffic jumps to 1900." |
| 1:10–1:50 | Diagnose | Change stream fires, incident appears, assumption highlighted red with source excerpt | "A MongoDB change stream wakes the Healer instantly. It finds the exact assumption reality just broke, and shows the original session as evidence." |
| 1:50–2:15 | Heal | Approve button, config updates, metrics recover | "A human approves, the fix applies, the system recovers. The lesson is stored as memory." |
| 2:15–2:35 | Remember | New coding session shows a warning | "Next time any agent touches checkout pooling, it's warned before it repeats the mistake." |
| 2:35–3:00 | MongoDB | Atlas view of the collections | "One database is the bridge between intent and failure: change streams, Vector Search, structured queries on assumptions, time-series metrics, TTL on raw transcripts, and schema validation guarding the contract between our two halves." |

**Rules for the demo:** the person driving does not talk; the person talking does not drive. Reset to a clean state before going on stage. Have a screen recording of a successful run as backup.

---

## 13. Judge Q&A Preparation

Everyone should be able to answer these.

- **Why MongoDB instead of a separate vector database?** Notes, metrics, incidents and embeddings live together, so one query can filter by service, time and team while searching by meaning. Fewer moving parts, one source of truth.
- **Why both structured matching and Vector Search?** Numeric assumptions need precise comparisons; vague ones need semantic matching. Structured first, semantic as fallback.
- **What if the LLM extracts a wrong assumption?** Users can correct or reject it, and every assumption shows a confidence score. Rejected assumptions are never matched.
- **What if nothing matches?** We showed it: the incident is marked unexplained, and we say so instead of guessing.
- **Isn't letting an agent touch production dangerous?** That's why every fix requires approval and every action is recorded in the incident.
- **How would this scale?** Multi-service dependency tracing with graph traversal, real deployment pipelines, and automated code fixes by a coding agent given the incident context.
- **What was hard?** Be honest. Likely candidates: getting reliable structured assumptions out of an LLM, or keeping two teams' documents in sync.
- **What would you improve?** See Section 15.

---

## 14. Risks and Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Integration breaks at 14:30 | Medium | Contract agreed first, seed data from minute one, contract check at lunch, one contract owner. |
| LLM extraction is unreliable | Medium | Prepare one well-behaved transcript for the demo; show confidence scores; allow correction. |
| Vector Search index not ready or misconfigured | Medium | Create indexes at kickoff, not later. Structured matching carries the main demo even if vector search struggles. |
| Change stream issues | Low–Medium | Test it in the first hour of the Healer's work. Ask MongoDB engineers early if stuck. |
| Scope creep | High | Section 10's cut order. Feature freeze at 15:30. |
| Demo fails live | Medium | Two rehearsals, clean reset, backup screen recording. |
| Secrets leaked in repo | Low | `.env` in ignore list from the first commit; `.env.example` only. |
| Team members can't explain the other half | Medium | Quick cross-walkthrough during integration. |

---

## 15. Stretch Goals (only if the core loop is done and rehearsed)

In priority order:

1. **Blast radius across services** — model service dependencies and use graph traversal to show which downstream services are affected.
2. **Hybrid search** — combine keyword and semantic search when matching symptoms to notes.
3. **Explain search results** — show why a note was retrieved, building trust in the diagnosis.
4. **Agent-written fix** — hand the incident context to a coding agent to propose a code change.
5. **Memory decay** — lower the weight of old, never-used notes over time.

Mention un-built stretch goals in the demo only as "what's next," in one sentence.

---

## 16. Submission Checklist

- [ ] Repo is public (or shared as required) with a clear commit history from both pairs
- [ ] No credentials or private data committed
- [ ] README covers: problem, architecture, MongoDB features and why each was chosen, how to run, what we'd improve
- [ ] Setup is repeatable from the README on a fresh machine
- [ ] Happy path tested and rehearsed
- [ ] Hard case tested
- [ ] Demo state reset
- [ ] Backup screen recording saved
- [ ] Submitted before 16:00 (target 15:45)

---

## 17. One-Sentence Pitch (memorise it)

**"Lineage captures the assumptions AI coding agents make when they write code, and when production breaks one of them, it finds it, fixes it with your approval, and makes sure no agent repeats the mistake — all powered by one MongoDB database bridging intent and failure."**
