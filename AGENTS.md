# Agent instructions for this repo

## Git workflow

- Don't commit or push directly to `main`. Do the work on a development branch
  (default: `develop`, unless told otherwise for a specific piece of work).
- Push changes to that branch as they're made, so real work doesn't sit only as
  local uncommitted state — commit at meaningful checkpoints, not just once at
  the very end of a long session.
- Merge `develop` back into `main` via a PR when a change is ready, rather than
  merging directly, unless told otherwise.

## Design documentation

- `PLAN.md` (repo root) is the living record of the app's current architecture
  and design decisions — distinct from `README.md`, which stays a retrospective
  build log. Don't merge the two.
- Any time a design or architecture decision changes — schema, data flow,
  service boundaries, storage choice, matching/generation approach, scope
  additions or cuts — update `PLAN.md` as part of that same change, not as an
  afterthought.
- Keep `PLAN.md`'s status markers current (✅ done · 🚧 decided, not yet built ·
  ❓ open decision · ⏸ deferred) — move items between sections as they progress
  rather than leaving stale status sitting there.
