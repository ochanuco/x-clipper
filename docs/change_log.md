# Changelog — Recent changes

## 2025-10-29 — IndexedDB cache for assets

- Added an IndexedDB-based cache to `background.ts` (DB: `x-clipper-cache`, store: `assets`).
  - `downloadAsset()` saves downloaded Blobs to the cache (keyed by generated `fileName`).
  - `uploadAssetToNotion()` removes cached entries on successful upload.
  - Cache save/delete failures are treated as warnings; main flow continues.
- Rationale: reduce redundant downloads and improve retry reliability for uploads.

Notes and follow-ups:
- Files larger than 20MB are still skipped for direct upload (existing behavior). Consider a separate flow for large files.
- Implement a TTL (suggestion: 7 days) and periodic cleanup to bound storage usage.
- Add UI in options for "pending media" management and manual retry.

See also: `docs/indexeddb.md` for implementation notes.
