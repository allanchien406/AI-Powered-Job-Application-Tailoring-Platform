# Monetisation plan

Strategy for turning the AI-Powered Job Application Tailoring Platform into a
revenue-generating product. This is the business-side companion to `PLAN.md`;
status markers: ✅ done · 🚧 decided, not yet built · ❓ open decision · ⏸ deferred.

## Goal

Convert a working product (profile intake → job description capture → tailored CV
generation) into a paid service for students and early-career job seekers,
starting with an Auckland University launch campaign, without spending meaningfully
on AI costs or burning goodwill with clunky paywalls.

## Unit economics reality check

The per-user AI cost is small, which reshapes the whole pricing strategy.

| Operation | AI machinery | Rough cost |
|---|---|---|
| Profile parse (`/profile/parse`) | 1 Claude Haiku call | ~$0.01 |
| Profile save + embeddings | Titan Embeddings per entry | fractions of a cent |
| CV generation (`/tailor-generate`) | 1 Claude Haiku call | ~$0.01–0.02 |
| **Full user journey** (parse + save + 2–3 CVs) | — | **~$0.05–0.15** |
| **200 free users** | — | **~$10–30** |

- ✅ Decided: **the 200 cap is a marketing lever (scarcity/urgency), not a
  cost-control lever.** There is room to be more generous, not less.
- ⏸ To confirm: the real per-CV number from CloudWatch usage data (Bedrock
  invocations × token counts) once the launch is live, so the model below is
  validated against actuals rather than estimates.

## Free-tier promotion (launch campaign)

### The offer

- First **200 people**, verified as students/alumni via an `.ac.nz` / Auckland
  University email, get the full journey free:
  1. profile parse + editable profile,
  2. saved job descriptions,
  3. **2 free tailored CV generations**,
  4. no card, no recurring anything.
- **Cap by verified email, enforced server-side** — one redemption per person.
  The cap also counts down live ("X of 200 left") as an urgency device.

### Anti-abuse: replace IP limits with email verification

- ❌ **IP limiting is rejected.** University campus runs shared NAT — hundreds of
  students behind one IP, so IP limits block real users while doing nothing
  against VPN/mobile hops. NZ home ISPs use CGNAT too, so it breaks at home as
  well.
- ✅ **Gate on verified ownership of an `.ac.nz` (or `auckland*`) email domain.**
  Verify with a magic link / one-time code — don't just accept the string.

### Posters → trackable promo code

- ✅ QR code on the posters resolves to a **campaign landing URL carrying a
  promo code** (e.g. `UOA-CV-200`).
- The 200 cap counts **redemptions of that code** — a DynamoDB counter keyed by
  promo code, with a per-verified-email uniqueness check.
- Bonus: attribution analytics — which poster/channel actually converted, and a
  live remaining-credits count for the landing page.

## Monetisation model: credits, not subscriptions

Students use a tool hard for 2–3 months during a job hunt, then stop. A
recurring $15–30/mo subscription fights that usage pattern and loses.

- 🚧 **Credit packs (one-time, no expiry).** Every registered user gets their
  free launch credits, then buys more when they need them:
  - e.g. **$15 for 10 CV generations**, or
  - **$25 "job hunt pack"** — 15 CVs + cover letters (once cover-letter
    generation ships), no expiry.
- 🚧 **Cover letters are the natural upsell.** Not built yet (see `PLAN.md` →
  Future improvements #5). When they land, they belong in the packs, not as a
  separate charge.
- ✅ **`/tailor-preview` (keyword-only, zero Bedrock) stays free forever** as
  the teaser — it demonstrates "matches your profile against this job" with no
  AI cost to us.

### Pricing signal vs competitors

Competitors (Rezi, Teal, Jobscan, Kickresume, etc.) run ~$15–30/mo behind
paywalls and are clunky. Our marginal cost is low enough that the product can be
the **generous, honest-priced alternative** — free credits to try, cheap
one-time packs to continue. That generosity is itself a differentiator.

## Phase 2: university B2B

Once the consumer path shows traction, sell institutional access:

- 🚧 **Auckland University career services buy per-seat access** — students get
  the tool because the institution pays, converting the "was an Auckland alum"
  edge and the poster campaign into a contract, not a marketing spend.
- 🚧 Also open to other NZ universities / polytechnics seeking an edge for their
  students' employability.

## Implementation backlog (backend)

The concrete engineering pieces the credit/gating system needs:

1. ❓ **Credits/redemptions table** — new DynamoDB table or a `credits`/
   `redemptions` field on the existing `ProfilesTable` item. One decision to
   make: separate table vs. inline field.
2. ❓ **Promo-code grant endpoint** — mint promo codes, apply a grant to a
   verified email, enforce the cap and one-per-email rule atomically.
3. ❓ **Email verification** — magic-link/OTP flow on the `/profile` path to
   prove `.ac.nz` ownership before granting free credits.
4. ❓ **Credit gating on `/tailor-generate`** — decrement a credit on a successful
   generation; 402/403 when the balance is exhausted, pointing at the buy flow.
5. ❓ **Billing/payment provider** — Stripe (or similar) for credit-pack
   purchase + a checkout flow in the dashboard; NZ-specific (pricing in NZD,
   tax/gst handling, Stripe NZ availability).
6. ⏸ **Live scarcity + attribution** — landing page shows "X of 200 left";
   per-promo-code conversion report.

## Open questions

- ❓ Should free-launch credits be reusable for multiple job hunts (no expiry),
  reflecting the campaign's goodwill intent, or should credits always expire?
- ❓ Is a $ sign-up required at launch — and is gating on card-on-file worth the
  conversion drop?
- ❓ Which cover-letter pricing once #5 in `PLAN.md` ships: bundled in packs only,
  or a separate cover-letter-only pack?

## Status summary

- ✅ Decided: free 200 launch, promo-code + email-verification gates, credits not
  subscriptions, `/tailor-preview` stays free.
- 🚧 Decided not yet built: credit packs, university B2B, all implementation
  backlog items.
- ❓ Open: the six open questions above.