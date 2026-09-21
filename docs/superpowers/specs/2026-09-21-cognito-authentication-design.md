# Cognito authentication — design

## Problem

The API Gateway (`infra/lib/infra-stack.ts`) has zero authorization on any route, and
`LoginPage.tsx` lets a user "sign in" by typing any email with no password and no
verification. Every Lambda (`profile-service`, `job-service`, `tailoring-service`)
trusts a plain `email` field from the request body/query string with no check that the
caller actually owns it — `intake-service` is open too, and burns a real Bedrock call
per request with no auth at all. Concretely: anyone who knows (or guesses) an email can
read and overwrite that person's profile and job descriptions today.

## Goal

Add real authentication (Amazon Cognito) so that:
- Every route requires a valid, signed-in caller.
- Every Lambda derives *who is calling* from a cryptographically verified token claim,
  never from a client-supplied field — closing the ownership gap above, not just adding
  a login screen in front of the same open API.

## Key decisions (and why)

1. **Cognito Hosted UI**, not a custom in-app sign-in form. Less frontend auth code
   (no hand-rolled PKCE/token exchange), at the cost of a redirect away from the app's
   UI during sign-in/sign-up. Cognito's Hosted UI handles sign-up, sign-in, and email
   verification (confirmation code) as one flow with no extra Lambda triggers.

2. **Derive identity from the token, never from the request body.** Every Lambda reads
   the caller's identity from `event.requestContext.authorizer.jwt.claims`, and drops
   any client-supplied `email`/user-id field from request payloads entirely. This is
   the actual fix for the vulnerability above: a request body value can be spoofed by
   anyone who can call the API; a claim inside a Cognito-signed token cannot.

3. **Identity key = Cognito `sub`, not email.** Originally the plan was to key
   DynamoDB by email and derive it from the token's `username` claim (achievable by
   configuring the User Pool so email *is* the username, not just an alias). That
   works for native email/password sign-up, but breaks for federated/social sign-in
   (Google, etc. would produce a `Google_<id>`-style username, not the email) — it's a
   sign-in-method-specific hack. `sub` is present in every token type (ID or access)
   and every sign-in method, and never changes even if the user's email does. So:
   - `ProfilesTable` / `JobDescriptionsTable` partition key becomes `user_id` (the
     Cognito `sub`), not `email`.
   - `email` moves into the profile item body as a normal, editable attribute — no
     longer load-bearing for security or lookups.
   - This also means social sign-in can be added later with zero backend changes,
     since `sub` doesn't care how the user authenticated.

4. **Bearer token = access token**, not ID token. Since identity now comes from `sub`
   (present in both token types), there's no need for the ID-token-only `email` claim
   that an earlier version of this design relied on. The access token is the
   purpose-built token for API authorization; using it is the simpler, more correct
   default once `sub` is the identity key.

5. **Social sign-in: explicitly deferred**, not part of this pass. Cognito supports it
   natively via Hosted UI (Google/Facebook/Apple/generic OIDC/SAML) and it's cheap to
   add later — the `sub`-based design above already accommodates it without rework.
   Not building it now: no product need for it yet (YAGNI).

## Architecture

### Cognito (new, in `infra/lib/infra-stack.ts`)

- **User Pool**: standard email/password sign-up, `selfSignUpEnabled: true`,
  `signInAliases: { email: true }`, Cognito's built-in email verification (confirmation
  code via Cognito's default email — no SES setup required to start).
- **User Pool Domain**: a Cognito-provided prefix (e.g.
  `cv-tailor-<account-id>.auth.us-east-1.amazoncognito.com`) for Hosted UI. No custom
  domain needed.
- **User Pool Client**: OAuth **Authorization Code Grant + PKCE** (correct flow for a
  public SPA client, no client secret), scopes `openid email profile`.
  - Callback/logout URLs: `http://localhost:5173/` to start (the dashboard has no
    hosting setup yet — no CloudFront/S3/Amplify Hosting in this repo — so there is no
    production URL to register yet). More URLs get added to the client whenever the
    dashboard is actually deployed somewhere.
- **JWT Authorizer** (`HttpJwtAuthorizer` from `aws-cdk-lib/aws-apigatewayv2-authorizers`):
  `jwtIssuer` = the User Pool's issuer URL, `jwtAudience` = `[userPoolClient.userPoolClientId]`.
  Attached to **every** route in `api.addRoutes(...)`, including `/profile/parse`
  (currently open and Bedrock-call-generating with zero auth).

### Frontend (`dashboard/`)

- Add `aws-amplify` (Auth category), configured with User Pool ID, Client ID, and the
  Hosted UI domain.
- `LoginPage.tsx`: the email-typing form is removed entirely, replaced with a single
  "Sign in" button calling `signInWithRedirect()`.
- New route (e.g. `/auth/callback`) that Hosted UI redirects back to; Amplify's
  listener completes the token exchange there, then the app navigates into `/profile`.
- `useCVStore`: `login(email)` as a user-facing action goes away. Auth state comes from
  Amplify (`fetchAuthSession()` / `getCurrentUser()`). The store's `email` field becomes
  a cached *display* value (populated from the loaded profile), not something the user
  sets or that gates access to anything.
- `api/backend.ts`: the single `request()` helper attaches
  `Authorization: Bearer <accessToken>` (from `fetchAuthSession()`) to every call.
  Amplify handles token refresh automatically. Every function in this file that
  currently takes an `email` parameter (`getProfile`, `saveJobDescription`,
  `generateTailoredCV`, etc.) drops it — the backend now derives identity from the
  token, not from an argument the frontend passes.

### Backend (`infra/lambda/*`)

- `ProfilesTable`: partition key renamed `email` → `user_id` (stores the Cognito
  `sub`). `email` becomes a normal attribute in the item body.
- `JobDescriptionsTable`: partition key `email` → `user_id`; sort key `job_id`
  unchanged.
- Each of `profile-service`, `job-service`, `tailoring-service` gets a small shared
  helper to extract the verified identity:
  ```python
  def get_user_id(event):
      return event["requestContext"]["authorizer"]["jwt"]["claims"]["sub"]
  ```
  and uses `user_id` (not a client-supplied `email`) for every `get_item` / `put_item`
  / `query` Key. No handler accepts an `email` request field for lookup purposes
  anymore.
- `intake-service` gets the JWT authorizer attached (closing the open-Bedrock-call
  hole) but needs no data-layer changes — it's stateless.

### Migration

There is exactly one real item in each table today (`allanchien@gmail.com`'s profile
and job descriptions). Both tables have `removalPolicy: DESTROY`. Given the tiny amount
of real data, the simplest path is: sign up through the new Cognito flow once, then
re-enter/re-save that profile and job description under the new `user_id`-keyed schema.
No scripted migration is needed for this amount of data — if this were done later, once
there's real user data, a proper migration script would be warranted instead.

## Testing / verification plan

Per this repo's standing testing convention (`CLAUDE.md`): every change here gets
actually run before being called done, not just type-checked/deployed. Concretely:

- CDK: `cdk synth` to catch template errors, then `cdk deploy` for real, checked against
  the actual deployed User Pool/Client/Authorizer in the AWS console or CLI.
- Backend: hit each endpoint with `curl` — once **without** an `Authorization` header
  (expect a 401 from the JWT authorizer, request never reaches the Lambda), and once
  **with** a real access token obtained by actually signing in through Hosted UI
  (expect success, and confirm the returned/stored data is keyed by `sub`, not email).
- Frontend: drive the real sign-up → email verification → sign-in → callback flow in a
  browser, confirm the app lands back in `/profile` with a valid session, and confirm a
  page reload keeps the user signed in (session persistence via Amplify).
- Cross-account check: sign up a second test user and confirm they cannot see the first
  user's profile/job descriptions (the actual vulnerability this whole change fixes).

## Explicitly out of scope for this pass

- Social/federated sign-in (Google, etc.) — deferred, see decision 5 above.
- Any dashboard hosting/deployment (S3, CloudFront, Amplify Hosting) — doesn't exist
  yet; Hosted UI callback URLs will need updating whenever that happens.
- Migrating existing/future data with a real migration script — not needed at current
  data volume (one profile).
- Fine-grained authorization (roles, admin access, sharing profiles between users) —
  not a requirement today; every user only ever accesses their own data.
