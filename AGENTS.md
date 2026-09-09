# Agent instructions for this repo

## Git workflow

- Don't commit or push directly to `main`. Do the work on a development branch
  (default: `develop`, unless told otherwise for a specific piece of work).
- Push changes to that branch as they're made, so real work doesn't sit only as
  local uncommitted state — commit at meaningful checkpoints, not just once at
  the very end of a long session.
- Merge `develop` back into `main` via a PR when a change is ready, rather than
  merging directly, unless told otherwise.
- Commit messages: no Claude attribution trailers at all — no `Co-Authored-By`,
  no `Claude-Session:` link. Just the commit message itself.

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

## Testing & verification workflow

**Any code change gets actually run before it's pushed — not just
type-checked/compiled or read through.** A syntax check confirms the code
parses; it says nothing about whether the logic does what it's supposed to.
For a change too small to warrant a full deploy, that still means executing
the changed logic somehow (a local invocation, a quick script exercising the
changed function against representative input) before pushing — reading the
diff and confirming it compiles is not "tested."

When a change needs fuller functional verification — deploying and hitting a
real endpoint, running a demo UI, exercising an actual data flow — not just a
local execution check:

1. Run and verify it yourself first (deploy it, curl it, drive it with a
   headless browser, check the logs — whatever actually proves it works),
   the same standard as everywhere else in this repo's work so far.
2. Hand back a concrete, step-by-step plan for how to run the same test
   manually, so the result can be independently reproduced and confirmed —
   don't just report "verified" and stop there.
3. Wait for confirmation that the manual test actually passed before treating
   the change as done. Verifying it yourself first is what makes the manual
   plan trustworthy to hand off — it isn't a substitute for that confirmation.
4. Only after that confirmation: update `PLAN.md`'s status for the
   thing being tested and commit/push. Don't mark something ✅ verified (in
   `PLAN.md` or in conversation) off the back of your own test run alone.
