# Phase 3 verification fixtures

Deterministic cases exercised via MOCK adapters and access helpers. These are
**not** live integration smoke tests.

## Denied scopes

| Fixture | How to trigger | Expected |
|---|---|---|
| Box list | `documents.listBoxFolder` with `simulate: "denied_scope"` | `errorCode=denied_scope`, empty items, MOCK label |
| Box download | file id `mock-file-denied` | `FileSourceError` / ingest failure mentioning denied scope |
| GHL contact | `crm.getContact` with `simulate: "denied_scope"` or contact `mock-contact-denied` | `ok=false`, error mentions `contacts.readonly` |
| GHL opps | `crm.listOpportunities` with `simulate: "denied_scope"` | `ok=false`, error mentions `opportunities.readonly` |

## Expired auth

| Fixture | How to trigger | Expected |
|---|---|---|
| Box | `simulate: "expired_auth"` on list, or file `mock-file-expired` | `errorCode=expired_auth` / reconnect messaging |
| GHL | `simulate: "expired_auth"` on read actions | `ok=false`, message includes expired |

## Pagination

| Fixture | How to trigger | Expected |
|---|---|---|
| Box folder pages | MOCK list with `limit` + `offset`; `nextOffset` when more remain | Cursor/offset progression without duplicates |
| Documents | `documents.listPaginated` with Convex `paginationOpts` | `page` / `continueCursor` / `isDone` |

## Cross-deal retrieval

| Fixture | How to trigger | Expected |
|---|---|---|
| Wrong deal | Ingest doc to deal A; call `documents.getChunksForDeal` with deal B | `null` (fail closed) |
| Org mismatch | Direct document id from another org | `get` / `listChunks` throw or return null |

## Scanned / empty PDF

| Fixture | How to trigger | Expected |
|---|---|---|
| `mock-file-scanned` | Ingest via MOCK Box | `extractionProvider=mock-ocr`, pages labeled **MOCK OCR** |

## CRM write safety

| Fixture | Expected |
|---|---|
| `crm.proposeUpdate` | Creates `approvals` + `outboundActions` status `proposed` only |
| `approvals.executeApproved` before approve | Error |
| `approvals.executeApproved` after approve | `status=dry_run`, no live GHL HTTP write |
| `ALLOW_LIVE_CRM_WRITES=true` in Phase 3 | Still fails closed with explicit message |
