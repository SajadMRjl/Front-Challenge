# Frontend Challenge: Loyalty Campaign Dashboard

Build a single-page dashboard for marketing managers to monitor loyalty campaign budgets and activate or pause campaigns.

**Suggested timebox: 3–4 hours, including setup.** Submit what you complete and document any unfinished work or architectural tradeoffs. Prioritize reliable behavior and clean engineering over visual polish. There are no hidden feature requirements.

## 1. What is provided

This repository contains a local mock API, realistic campaign fixtures, scenario controls, and API tests. **No frontend application or solution is included.**

Use Node.js **22.12 or later** and npm. From the repository root:

```sh
npm ci
npm run mock-api

```

Keep that terminal running. The API is available at `http://localhost:3001`, accepts JSON, and enables CORS for local frontend development. To check it:

```sh
curl http://localhost:3001/health
curl http://localhost:3001/campaigns

```

## 2. Core engineering priorities

You are free to choose your libraries, state management approach, styling solution, and project structure. Rather than prescribing a specific implementation pattern, we evaluate how you make architectural decisions based on the following pillars:

- **React Fundamentals:** Appropriate use of hooks, component lifecycles, state derivation, and rendering behavior.
- **Separation of Concerns:** Clear architectural layering between API communication, asynchronous state/business logic, and purely presentational UI components.
- **Scalability & Performance:** Thoughtful state structure, avoiding unnecessary re-renders or redundant network requests, and designing patterns that remain maintainable as the application grows in features and data volume.
- **TypeScript & Reliability:** Strong type safety across the API boundary and component props, resilient error handling, and predictable asynchronous state transitions.

## 3. Required behavior

### Display campaigns and budgets

Fetch **GET /campaigns** and display the results in a table or card grid. Each campaign must show:

- Name, status, reward type, and creation date.
- Budget, spent amount, remaining budget, and utilization.
- An appropriate status action.

Use these rules consistently:

| Concern          | Required rule                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| Money            | USD in whole dollars; format with a currency symbol and grouping                                 |
| Remaining budget | `budget - spent`; keep negative values for overspending                                          |
| Utilization      | `spent / budget × 100`, rounded to at most one decimal place                                     |
| Zero budget      | Show `N/A` for utilization; no `NaN` or `Infinity`                                               |
| Overspending     | Display the actual percentage, even above 100%; cap a visual progress bar at 100% if you add one |
| Dates            | Display calendar dates in UTC, e.g. `Oct 22, 2026`; no time-of-day required                      |
| Ordering         | Preserve the API's newest-first order; toggling status must not reorder campaigns                |

Budgets do not restrict status changes. Zero-budget, fully spent, and overspent campaigns can be activated/resumed. Only `status` is editable. Reward types are display categories and require no reward calculation.

### Loading, errors, and empty states

- Show loading feedback on the initial request; do not flash an empty state while loading.
- If the initial request fails, show a useful error and an explicit retry action.
- Distinguish an empty collection from an empty filtered result.
- A successful response must clear a previous fetch error.
- If a subsequent fetch fails after data has already loaded, keep the existing data visible and surface an error with a retry option.

### Status filters

Provide **All**, **Active**, **Draft**, and **Paused** filters (defaulting to **All**). Keep all filter choices visible even when a status has no matching campaigns. Filter counts are optional.

Preserve the active filter and list ordering during status updates and retries. Filter persistence across page reloads is not required.

### Status updates

| Current status | Action   | Requested status |
| -------------- | -------- | ---------------- |
| `draft`        | Activate | `active`         |
| `active`       | Pause    | `paused`         |
| `paused`       | Resume   | `active`         |

Send **PATCH /campaigns/:id** with `{ "status": "..." }`. Draft is an initial state; there is no action to return to Draft.

- Show pending feedback and prevent duplicate submissions while an update is in flight.
- When an update succeeds, reflect the new status in the UI. If the updated campaign no longer matches the active filter, it should leave the current view without resetting the filter.
- Successful updates must survive a browser reload.
- When an update fails, display actionable error feedback, ensure the UI reflects the actual status, and allow the user to try again.

## 4. Technical boundaries

- Define strict types from the API contract and avoid `any` for campaign data.
- Keep the supplied API contract and fixtures intact; use scenario controls for testing.

**Out of scope:** campaign creation/deletion, editing budgets/names, search, user-selected sorting, pagination, campaign detail pages, authentication, summary charts.

Assume a single marketing manager uses this dashboard at a time.

## 5. API contract

The mock uses `json-server` as its data store with explicit routes and validation. Normal campaign requests take approximately **400 ms**. Control and health endpoints are immediate. No random failures occur.

### Campaign fields

All fields are required and non-null. IDs are opaque strings. Seed amounts are nonnegative whole numbers, dates are valid ISO 8601 UTC timestamps, and names are nonempty. `spent` may exceed `budget`. Zero budget has zero spent in the supplied data.

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | Stable unique identifier |
| `name` | string | Display name |
| `status` | `"active" \| "draft" \| "paused"` | Lifecycle status |
| `rewardType` | `"points" \| "discount" \| "multiplier"` | Reward category |
| `budget` | number | USD budget, whole dollars |
| `spent` | number | USD spent, whole dollars |
| `createdAt` | string | ISO 8601 UTC creation time |

### GET /campaigns

Returns **200** and a JSON array. There is no pagination or response wrapper. The `{ "campaigns": [...] }` wrapper exists only in `db.json`. Responses are sorted by `createdAt` descending, then `id` ascending for ties. Query parameters (including server-side filters) are rejected with **400**.

Example array element (the complete normal response contains 12 campaigns):

```json
[
  {
    "id": "c_101",
    "name": "Summer Welcome Bonus",
    "status": "active",
    "rewardType": "points",
    "budget": 50000,
    "spent": 12400,
    "createdAt": "2026-10-01T10:00:00Z"
  }
]
```

### GET /campaigns/:id

Returns **200** with a campaign object or **404** if missing. This endpoint is available for inspection; the dashboard does not need to use it.

### PATCH /campaigns/:id

```sh
curl -X PATCH http://localhost:3001/campaigns/c_101 \
  -H 'Content-Type: application/json' \
  -d '{"status":"paused"}'

```

Returns **200** and the complete updated campaign. Only `status` changes; ID, budget, spent, name, reward type, and creation time are preserved. Updates persist to `db.json` and survive API restarts.

Allowed transitions are Draft → Active, Active → Paused, and Paused → Active. Repeating the **current status** returns 200 with the unchanged campaign, making retries safe. All other transitions return 409. Extra fields are rejected. Send `Content-Type: application/json`.

### Errors

All application errors use the same JSON shape:

```json
{
  "code": "SIMULATED_PATCH_ERROR",
  "message": "Campaign could not be updated. Please try again."
}
```

| HTTP status | Code                    | Meaning                                          |
| ----------- | ----------------------- | ------------------------------------------------ |
| 400         | `INVALID_PAYLOAD`       | Missing/invalid status or extra body fields      |
| 400         | `INVALID_JSON`          | Malformed JSON request body                      |
| 400         | `UNSUPPORTED_QUERY`     | Query parameters on campaign endpoints           |
| 400         | `INVALID_SCENARIO`      | Invalid mock scenario control request            |
| 404         | `CAMPAIGN_NOT_FOUND`    | Unknown campaign ID                              |
| 404         | `ENDPOINT_NOT_FOUND`    | Unknown endpoint                                 |
| 405         | `METHOD_NOT_ALLOWED`    | Unsupported method on a campaign endpoint        |
| 409         | `INVALID_TRANSITION`    | Disallowed lifecycle transition                  |
| 503         | `SIMULATED_LIST_ERROR`  | Deliberate list failure                          |
| 503         | `SIMULATED_PATCH_ERROR` | Deliberate mutation failure; no data was changed |
| 500         | `INTERNAL_ERROR`        | Unexpected mock failure                          |

## 6. Seed dataset

`mock/seed.json` is the original fixture; `db.json` is the mutable database. The seed includes **12 campaigns: 4 Active, 4 Draft, 4 Paused**, and four of each reward type. Long names, small/large budgets, zero budget, exact exhaustion, overspending, and date ties are intentional.

| ID    | Name                                                                 | Status | Reward     | Budget  | Spent  | Purpose                                |
| ----- | -------------------------------------------------------------------- | ------ | ---------- | ------- | ------ | -------------------------------------- |
| c_101 | Summer Welcome Bonus                                                 | active | points     | 50,000  | 12,400 | Standard partial utilization           |
| c_102 | Inactive User Reactivation                                           | draft  | discount   | 10,000  | 0      | Activate an unspent draft              |
| c_103 | VIP Tier Upgrade                                                     | paused | multiplier | 25,000  | 25,000 | Exactly 100% spent                     |
| c_104 | Birthday Rewards                                                     | active | points     | 15,000  | 7,500  | 50% utilization                        |
| c_105 | Weekend Double Points                                                | paused | multiplier | 8,000   | 7,200  | 90% utilization                        |
| c_106 | New Member Discount                                                  | draft  | discount   | 5,000   | 0      | Additional draft                       |
| c_107 | Community Thank You                                                  | active | points     | 0       | 0      | Zero budget; utilization N/A           |
| c_108 | Autumn Return Discount                                               | paused | discount   | 10,000  | 11,250 | Negative remaining; 112.5% utilization |
| c_109 | Holiday Loyalty Multiplier                                           | draft  | multiplier | 125,000 | 0      | Large budget and date tie              |
| c_110 | Neighborhood Store Welcome                                           | active | discount   | 100     | 1      | Small budget; 1% utilization           |
| c_111 | Exclusive Anniversary Rewards for Long-Standing Loyalty Club Members | paused | points     | 40,000  | 12,000 | Long name layout                       |
| c_112 | Partner Launch Multiplier                                            | draft  | multiplier | 20,000  | 0      | Same timestamp as c_109                |

Every status and every reward type has four campaigns. Fixture dates are fixed; do not infer expiry or eligibility from today's date.

## 7. Scenario testing

**No frontend URL changes, database edits, or API restarts are needed.** With the API running, use another terminal at the repository root:

```sh
npm run mock-api:scenario -- slow
npm run mock-api:scenario -- normal
npm run mock-api:scenario -- status

```

| Scenario      | Behavior                                                   | What to verify                                        |
| ------------- | ---------------------------------------------------------- | ----------------------------------------------------- |
| `normal`      | All campaigns; 400 ms delay                                | Main flow and persistence                             |
| `slow`        | All campaigns; 2-second delay on GET/PATCH                 | Loading states and duplicate-action prevention        |
| `empty`       | List returns `[]`; underlying data unchanged               | Empty collection state                                |
| `no-drafts`   | List excludes drafts; underlying data unchanged            | Empty Draft filter without mutating four campaigns    |
| `list-error`  | List always returns 503; other campaign endpoints work     | Initial error, subsequent fetch error, retry/recovery |
| `patch-error` | List works; valid PATCH always returns 503 without writing | Update failure feedback and status preservation       |

Scenarios remain active until changed or reset. Switching scenarios **does not reset campaign changes or push updates to the frontend**. The default scenario after an API restart is `normal`.

### Reset without restarting

```sh
npm run mock-api:scenario -- reset

```

This restores all 12 original campaigns and switches to `normal`. **It overwrites campaign changes.** Wait for pending updates to finish before resetting.

If the API is stopped, `npm run mock-api:reset` restores `db.json` from disk. Do not run this offline reset command against a running API; use the live reset instead.

### Control endpoints (development tools only)

The CLI uses these endpoints. Candidates do **not** need to call them from the dashboard or build a scenario UI.

| Endpoint               | Response / request                                                     |
| ---------------------- | ---------------------------------------------------------------------- |
| `GET /health`          | `{ "status": "ok" }`                                                   |
| `GET /__mock`          | Current scenario/settings and available scenario names                 |
| `PUT /__mock/scenario` | Send `{ "scenario": "patch-error" }`; returns active settings          |
| `POST /__mock/reset`   | Restores seed; returns `{ "scenario": "normal", "campaignCount": 12 }` |

## 8. Acceptance checklist

- [ ] A clean checkout can be installed and run using your submission instructions.
- [ ] All 12 original campaigns display; budget rules and dates are accurate.
- [ ] Initial loading, fetch failure/retry, subsequent fetch failure, empty collection, and empty filter states work.
- [ ] All four filters work and remain available with zero matches.
- [ ] Activate, Pause, and Resume send correct PATCH bodies and persist after reload.
- [ ] Pending updates show feedback and prevent duplicate submissions.
- [ ] Failed updates show feedback, preserve the accurate status, and allow another attempt.
- [ ] Updating a campaign preserves the selected filter and list ordering.
- [ ] Layout remains usable on a narrow screen.
- [ ] Frontend typecheck and production build pass.

The supplied infrastructure tests can be run with `npm run test:mock-api`; they do not test your frontend. Automated frontend tests are optional within the timebox.

## 9. Submission and evaluation

Submit a repository or branch with your frontend and a root `SUBMISSION.md` containing:

1. Exact commands to install and run the API and frontend from a fresh checkout.
2. Frontend typecheck/build commands and test commands if applicable.
3. Brief overview of your architecture: how you structured your data and presentation layers, state management choices, and performance/scalability considerations.
4. Scenarios tested, any assumptions/tradeoffs, unfinished work, and approximate time spent.
5. Any tools or AI assistance used and how you verified the output.

Use documentation and tools as you normally would. You do not need to deploy it, provide a video, or create a pixel-perfect design.

*Good luck :D*
