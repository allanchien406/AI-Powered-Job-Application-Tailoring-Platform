# Cognito Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current "type any email, no password" login with real Cognito authentication, and close the underlying vulnerability it was covering for: every Lambda deriving the caller's identity from a verified JWT claim instead of a client-supplied `email` field.

**Architecture:** A Cognito User Pool + Hosted UI issues OAuth tokens via Authorization Code + PKCE; an `HttpJwtAuthorizer` on every API Gateway route rejects unauthenticated requests before they reach any Lambda; each Lambda reads the caller's Cognito `sub` from the verified JWT claims and uses it as the DynamoDB partition key (`user_id`), replacing `email` as the identity/lookup key everywhere. `email` becomes a normal, non-security-relevant profile attribute.

**Tech Stack:** AWS CDK (TypeScript), Amazon Cognito (User Pools, Hosted UI), API Gateway HTTP API JWT authorizer, `aws-amplify` (v6) on the frontend, Python 3.12 Lambdas, DynamoDB.

**Spec:** `docs/superpowers/specs/2026-09-21-cognito-authentication-design.md`

## Global Constraints

- No Claude attribution trailers in commit messages (per `CLAUDE.md`).
- Work happens on `develop`, pushed as it's made — never commit/push directly to `main`.
- Every change gets actually run/verified before being called done — deploy it, curl it, or drive it in a browser; a syntax check or `cdk synth` alone is not "tested" (per `CLAUDE.md`).
- Implement in the three phases below, one at a time — do not start a later phase's tasks until the current phase's manual verification task has been confirmed.
- `PLAN.md`'s "Authentication (Cognito)" section status marker moves from 🚧 to ✅ once all three phases are verified — not before, and not off the back of self-verification alone (needs the user's confirmation per `CLAUDE.md`'s testing workflow).

---

# Phase 1: Cognito + CDK infrastructure

Adds the User Pool, Hosted UI, and JWT authorizer. Lambda code is untouched in
this phase — this phase is fully verifiable with `curl` alone, with no
frontend or Lambda changes involved.

### Task 1: Cognito User Pool, Domain, and User Pool Client

**Files:**
- Modify: `infra/lib/infra-stack.ts`

**Interfaces:**
- Produces: `userPool` (`cognito.UserPool`), `userPoolClient` (`cognito.UserPoolClient`), `userPoolDomain` (`cognito.UserPoolDomain`) — consumed by Task 2 (authorizer) and by CfnOutputs read in Phase 2's frontend config.

- [ ] **Step 1: Add the Cognito imports**

In `infra/lib/infra-stack.ts`, add to the top of the file, alongside the existing imports:

```ts
import * as cognito from "aws-cdk-lib/aws-cognito";
```

- [ ] **Step 2: Add the User Pool, Domain, and Client**

Add this block right after the `jobDescriptionsTable` declaration (after line 45, before the "Bedrock access" comment block):

```ts
    // --- Authentication ---
    // Hosted UI handles sign-up, sign-in, and email verification as one flow —
    // no custom Lambda triggers needed. See
    // docs/superpowers/specs/2026-09-21-cognito-authentication-design.md.

    const userPool = new cognito.UserPool(this, "UserPool", {
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      removalPolicy: cdk.RemovalPolicy.DESTROY, // NOT recommended for production environments
    });

    // ALLOW_ADMIN_USER_PASSWORD_AUTH is enabled purely so this pool can be
    // verified from the CLI (see Task 3) without needing a browser — Hosted
    // UI (Authorization Code + PKCE) is the actual sign-in flow real users
    // go through, added in Phase 2.
    const userPoolClient = userPool.addClient("UserPoolClient", {
      generateSecret: false,
      authFlows: { adminUserPassword: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: ["http://localhost:5173/auth/callback"],
        logoutUrls: ["http://localhost:5173/"],
      },
    });

    // Cognito-provided domain prefix (no custom domain needed). Must be
    // globally unique — the account ID guarantees that.
    const userPoolDomain = userPool.addDomain("UserPoolDomain", {
      cognitoDomain: { domainPrefix: `cv-tailor-${this.account}` },
    });

    new cdk.CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new cdk.CfnOutput(this, "UserPoolClientId", { value: userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, "UserPoolDomain", {
      value: `${userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com`,
    });
```

- [ ] **Step 3: Synth to check for errors**

Run: `cd infra && npx cdk synth InfraStack > /dev/null`
Expected: no errors. If the domain prefix token causes a synth-time validation error, replace `` `cv-tailor-${this.account}` `` with a fixed unique string (e.g. `cv-tailor-app-2026`) instead — domain prefixes must be globally unique across all of Cognito, not just your account.

- [ ] **Step 4: Commit**

```bash
git add infra/lib/infra-stack.ts
git commit -m "Add Cognito User Pool, Hosted UI domain, and User Pool Client"
```

---

### Task 2: JWT authorizer on every route

**Files:**
- Modify: `infra/lib/infra-stack.ts`

**Interfaces:**
- Consumes: `userPool`, `userPoolClient` from Task 1.
- Produces: every existing route now requires a valid Cognito-issued JWT.

- [ ] **Step 1: Add the authorizer import**

```ts
import { HttpJwtAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
```

- [ ] **Step 2: Create the authorizer, right after the `api` declaration**

```ts
    const jwtAuthorizer = new HttpJwtAuthorizer(
      "CognitoAuthorizer",
      `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`,
      { jwtAudience: [userPoolClient.userPoolClientId] },
    );
```

- [ ] **Step 3: Attach it to every `api.addRoutes(...)` call**

Add `authorizer: jwtAuthorizer` to all six existing route registrations — `/profile`, `/profile/parse`, `/job-description`, `/job-description/list`, `/tailor-preview`, `/tailor-generate`. For example:

```ts
    api.addRoutes({
      path: "/profile",
      methods: [
        cdk.aws_apigatewayv2.HttpMethod.GET,
        cdk.aws_apigatewayv2.HttpMethod.PUT,
      ],
      integration: new HttpLambdaIntegration(
        "ProfileServiceHandlerIntegration",
        profileServiceHandler,
      ),
      authorizer: jwtAuthorizer,
    });
```

Repeat the same `authorizer: jwtAuthorizer,` addition for the other five `addRoutes` calls (`/profile/parse`, `/job-description`, `/job-description/list`, `/tailor-preview`, `/tailor-generate`), changing nothing else about them.

- [ ] **Step 4: Synth to check for errors**

Run: `cd infra && npx cdk synth InfraStack > /dev/null`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add infra/lib/infra-stack.ts
git commit -m "Require a valid Cognito JWT on every API Gateway route"
```

---

### Task 3: Deploy and verify Phase 1

**Files:** none (deployment + CLI verification only)

- [ ] **Step 1: Deploy**

Run: `cd infra && npx cdk deploy --require-approval never`
Expected: succeeds; note the `UserPoolId`, `UserPoolClientId`, and `UserPoolDomain` values from the Outputs — Phase 2 needs them.

- [ ] **Step 2: Confirm an unauthenticated request is now rejected**

```bash
curl -i https://<HttpApiUrl>/profile?email=nobody@example.com
```
Expected: `HTTP/2 401` — the request never reaches `profile-service` at all (compare to before Phase 1, where this returned a 404 "Profile not found").

- [ ] **Step 3: Create a real Cognito test user via the CLI (no browser needed)**

```bash
aws cognito-idp admin-create-user \
  --user-pool-id <UserPoolId> \
  --username phase1test@example.com \
  --user-attributes Name=email,Value=phase1test@example.com Name=email_verified,Value=true \
  --message-action SUPPRESS \
  --temporary-password 'TempPass123!'

aws cognito-idp admin-set-user-password \
  --user-pool-id <UserPoolId> \
  --username phase1test@example.com \
  --password 'RealPass123!' \
  --permanent
```

- [ ] **Step 4: Get a real access token via the CLI**

```bash
aws cognito-idp admin-initiate-auth \
  --user-pool-id <UserPoolId> \
  --client-id <UserPoolClientId> \
  --auth-flow ADMIN_USER_PASSWORD_AUTH \
  --auth-parameters USERNAME=phase1test@example.com,PASSWORD='RealPass123!'
```
Expected: a JSON response with `AuthenticationResult.AccessToken`.

- [ ] **Step 5: Confirm an authenticated request reaches the Lambda**

```bash
curl -i https://<HttpApiUrl>/profile?email=phase1test@example.com \
  -H "Authorization: Bearer <AccessToken from Step 4>"
```
Expected: `HTTP/2 404` with `{"error": "Profile not found"}` — a 404 here (not a 401) proves the request passed the authorizer and reached `profile-service`'s unchanged Lambda code, which correctly reports no profile exists yet for this brand-new user.

- [ ] **Step 6: Clean up the test user**

```bash
aws cognito-idp admin-delete-user --user-pool-id <UserPoolId> --username phase1test@example.com
```

- [ ] **Step 7: Report results and wait for confirmation**

Hand back the exact commands above (with real `<HttpApiUrl>`/`<UserPoolId>`/`<UserPoolClientId>` filled in) so the result can be reproduced independently, per `CLAUDE.md`'s testing workflow. Do not start Phase 2 until this is confirmed.

---

# Phase 2: Frontend Hosted UI flow

Replaces the email-typing login with real Cognito sign-in, while the backend
still accepts the pre-Phase-3 `email`-keyed requests underneath (Lambda code
is untouched in this phase too) — so this phase is independently verifiable
end-to-end in a browser: sign up, verify, sign in, land on the profile page,
load/save a profile.

### Task 4: Add `aws-amplify` and configure it

**Files:**
- Modify: `dashboard/package.json`
- Create: `dashboard/src/amplify-config.ts`
- Modify: `dashboard/src/main.tsx`
- Create: `dashboard/.env.local` (gitignored — not committed)

**Interfaces:**
- Produces: Amplify configured and ready for `aws-amplify/auth` calls used by Tasks 5-8.

- [ ] **Step 1: Add the dependency**

```bash
cd dashboard && npm install aws-amplify@^6.20.0
```

- [ ] **Step 2: Add environment variables**

Create `dashboard/.env.local` (following the existing `VITE_API_URL` convention in `api/backend.ts`) using the values from Phase 1 Task 3's deploy output:

```
VITE_COGNITO_USER_POOL_ID=<UserPoolId>
VITE_COGNITO_CLIENT_ID=<UserPoolClientId>
VITE_COGNITO_DOMAIN=<UserPoolDomain>
```

Confirm `.env.local` is covered by `dashboard/.gitignore` (Vite's default template already ignores `*.local` — verify with `git check-ignore dashboard/.env.local`, expected output: the file path, meaning it's ignored).

- [ ] **Step 3: Create the Amplify config module**

```ts
// dashboard/src/amplify-config.ts
import { Amplify } from 'aws-amplify';

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID,
      userPoolClientId: import.meta.env.VITE_COGNITO_CLIENT_ID,
      loginWith: {
        oauth: {
          domain: import.meta.env.VITE_COGNITO_DOMAIN,
          scopes: ['openid', 'email', 'profile'],
          redirectSignIn: ['http://localhost:5173/auth/callback'],
          redirectSignOut: ['http://localhost:5173/'],
          responseType: 'code',
        },
      },
    },
  },
});
```

- [ ] **Step 4: Import it once, before the app renders**

In `dashboard/src/main.tsx`, add `import './amplify-config';` as the first import (before any other import that might trigger an Amplify Auth call).

- [ ] **Step 5: Verify the app still builds and boots**

Run: `cd dashboard && npx tsc --noEmit && npx vite build`
Expected: both succeed with no errors.

- [ ] **Step 6: Commit**

```bash
git add dashboard/package.json dashboard/package-lock.json dashboard/src/amplify-config.ts dashboard/src/main.tsx
git commit -m "Add and configure aws-amplify for Cognito Hosted UI"
```

---

### Task 5: Rework LoginPage.tsx

**Files:**
- Modify: `dashboard/src/pages/LoginPage.tsx`

**Interfaces:**
- Consumes: `signInWithRedirect` from `aws-amplify/auth`.

- [ ] **Step 1: Replace the email form with a Hosted UI sign-in button**

Replace the entire contents of `dashboard/src/pages/LoginPage.tsx` with:

```tsx
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { signInWithRedirect } from 'aws-amplify/auth';
import { Button } from '../components/ui';

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper">
      <div className="w-[360px] rounded-2xl border border-sand bg-white p-10 text-center shadow-card">
        <h1 className="mb-2 mt-0 font-display text-[28px] text-ink">CV Tailor</h1>
        <p className="mb-6 text-xs leading-normal text-ink-soft">
          Paste your background once, save the jobs you're applying for, and get a CV tailored to
          each one.
        </p>
        <Button
          onClick={() => signInWithRedirect()}
          className="mb-3 w-full px-2.5 py-2.5 text-sm"
        >
          Sign in / Sign up
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => navigate('/demo')}
          className="w-full px-2.5 py-2.5 text-[13px]"
        >
          See the offline demo (fake data) →
        </Button>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Verify it compiles**

Run: `cd dashboard && npx tsc --noEmit`
Expected: no errors (there will be an unused-import warning risk only if `Field`/`Input` remain imported — they don't in the version above).

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/pages/LoginPage.tsx
git commit -m "Replace email-typing login with Cognito Hosted UI sign-in"
```

---

### Task 6: Auth callback route

**Files:**
- Create: `dashboard/src/pages/AuthCallbackPage.tsx`
- Modify: `dashboard/src/App.tsx`

**Interfaces:**
- Consumes: `getCurrentUser`, `Hub` from `aws-amplify/auth` / `aws-amplify/utils`.
- Produces: `/auth/callback` route that lands the user on `/profile` once Hosted UI redirects back.

- [ ] **Step 1: Create the callback page**

```tsx
// dashboard/src/pages/AuthCallbackPage.tsx
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentUser } from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';

export const AuthCallbackPage: React.FC = () => {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = Hub.listen('auth', ({ payload }) => {
      if (payload.event === 'signInWithRedirect') {
        navigate('/profile', { replace: true });
      } else if (payload.event === 'signInWithRedirect_failure') {
        setError('Sign-in failed. Please try again.');
      }
    });

    // Amplify may finish processing the redirect before this listener is
    // registered — check directly too, in case the Hub event already fired.
    getCurrentUser()
      .then(() => navigate('/profile', { replace: true }))
      .catch(() => {
        /* not signed in yet — wait for the Hub event above */
      });

    return unsubscribe;
  }, [navigate]);

  if (error) {
    return <div className="p-8 text-center text-sm text-ink">{error}</div>;
  }
  return <div className="p-8 text-center text-sm text-ink-soft">Signing you in…</div>;
};
```

- [ ] **Step 2: Register the route**

In `dashboard/src/App.tsx`, add the import and route:

```tsx
import { AuthCallbackPage } from './pages/AuthCallbackPage';
```

```tsx
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
```
(add it alongside the other `<Route>` entries, before the catch-all `*` route).

- [ ] **Step 3: Verify it compiles**

Run: `cd dashboard && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/pages/AuthCallbackPage.tsx dashboard/src/App.tsx
git commit -m "Add /auth/callback route to complete Hosted UI sign-in"
```

---

### Task 7: `useCVStore` — replace manual login with session-driven auth

**Files:**
- Modify: `dashboard/src/store/useCVStore.ts`
- Modify: `dashboard/src/App.tsx`
- Modify: `dashboard/src/components/Shell.tsx`

**Interfaces:**
- Produces: `useCVStore().initFromSession(): Promise<void>`, `useCVStore().logout(): Promise<void>` (replacing the old synchronous `logout` and removing `login` entirely).

- [ ] **Step 1: Replace `login` with `initFromSession`, and make `logout` async**

In `dashboard/src/store/useCVStore.ts`, change the `AppStore` interface:

```ts
  initFromSession: () => Promise<void>;
  logout: () => Promise<void>;
```
(replacing the old `login: (email: string) => void;` and `logout: () => void;` lines).

Replace the `login` action's implementation with:

```ts
  initFromSession: async () => {
    const { fetchUserAttributes } = await import('aws-amplify/auth');
    try {
      const attrs = await fetchUserAttributes();
      const email = (attrs.email || '').toLowerCase();
      localStorage.setItem(EMAIL_KEY, email);
      set({ email });
    } catch {
      // Not signed in — leave the store's email empty so existing
      // per-page "you need to sign in first" guards keep working.
      localStorage.removeItem(EMAIL_KEY);
      set({ email: '' });
    }
  },
```

Replace the `logout` action's implementation with:

```ts
  logout: async () => {
    const { signOut } = await import('aws-amplify/auth');
    await signOut();
    localStorage.removeItem(EMAIL_KEY);
    localStorage.removeItem(DIR_STORAGE_KEY);
    localStorage.removeItem(OLD_VIEWER_STORAGE_KEY);
    set({ email: '', cvs: [], viewerCv: null, viewerMeta: null, viewerJobId: null, viewerTemplateId: DEFAULT_TEMPLATE_ID });
  },
```

- [ ] **Step 2: Call `initFromSession()` once at app startup**

In `dashboard/src/App.tsx`, add:

```tsx
import { useEffect } from 'react';
import { useCVStore } from './store/useCVStore';
```

and inside the `App` component, before the `return`:

```tsx
  const initFromSession = useCVStore((state) => state.initFromSession);

  useEffect(() => {
    initFromSession();
  }, [initFromSession]);
```

- [ ] **Step 3: Update `Shell.tsx`'s logout button for the now-async `logout`**

In `dashboard/src/components/Shell.tsx`, change:

```tsx
              onClick={() => {
                logout();
                navigate('/');
              }}
```
to:
```tsx
              onClick={async () => {
                await logout();
                navigate('/');
              }}
```

- [ ] **Step 4: Verify it compiles**

Run: `cd dashboard && npx tsc --noEmit`
Expected: no errors, and no remaining references to a `login` action (grep to confirm: `grep -rn "useCVStore((state) => state.login)" dashboard/src` should return nothing).

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/store/useCVStore.ts dashboard/src/App.tsx dashboard/src/components/Shell.tsx
git commit -m "Derive signed-in email from the Cognito session, not manual login"
```

---

### Task 8: Attach the access token to every API request

**Files:**
- Modify: `dashboard/src/api/backend.ts`

**Interfaces:**
- Produces: every `request<T>()` call now sends `Authorization: Bearer <access token>` when a session exists.

- [ ] **Step 1: Update `request()`**

In `dashboard/src/api/backend.ts`, add the import at the top:

```ts
import { fetchAuthSession } from 'aws-amplify/auth';
```

Replace the `request` function with:

```ts
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const session = await fetchAuthSession();
  const token = session.tokens?.accessToken?.toString();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed with status ${res.status}`);
  }
  return data as T;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd dashboard && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/api/backend.ts
git commit -m "Attach the Cognito access token to every API request"
```

---

### Task 9: Manual browser verification of Phase 2

**Files:** none (manual verification only — no browser tooling available in this session, so this task is handed to the user rather than self-verified first)

- [ ] **Step 1: Start the dev server**

Run: `cd dashboard && npm run dev`

- [ ] **Step 2: Sign up**

Open the app, click "Sign in / Sign up", and on the Hosted UI page, sign up with a real email you can receive mail at. Enter the confirmation code Cognito emails you.

- [ ] **Step 3: Confirm the callback lands on the profile page**

After confirming, Hosted UI should redirect to `http://localhost:5173/auth/callback`, briefly show "Signing you in…", then land on `/profile`.

- [ ] **Step 4: Confirm the session persists**

Reload the page. Expected: still signed in (not bounced back to `/`), since Amplify persists the session.

- [ ] **Step 5: Confirm profile save/load still works**

Paste some background text, save the profile, reload, confirm it's still there. This exercises `PUT /profile` and `GET /profile` with the new `Authorization` header, against the still-unchanged (`email`-keyed) `profile-service` Lambda from before Phase 3.

- [ ] **Step 6: Confirm logout works**

Click "Logout" in the header. Expected: returns to `/` (the sign-in page).

- [ ] **Step 7: Report results and wait for confirmation**

Since no browser tooling is available this session, this is the user's test to run, not a self-verification. Do not start Phase 3 until the user confirms all of the above actually passed.

---

# Phase 3: Backend identity derivation + DynamoDB key migration

Switches every Lambda from trusting a client-supplied `email` to deriving
`user_id` (the Cognito `sub`) from the verified JWT, and moves the DynamoDB
partition key from `email` to `user_id`. This is the change that actually
closes the vulnerability the whole feature exists to fix.

### Task 10: CDK — rename the DynamoDB partition key to `user_id`

**Files:**
- Modify: `infra/lib/infra-stack.ts`

**Interfaces:**
- Produces: `ProfilesTable`/`JobDescriptionsTable` now keyed by `user_id` instead of `email`.

- [ ] **Step 1: Change both table definitions**

```ts
    const profilesTable = new dynamodb.Table(this, "ProfilesTable", {
      partitionKey: { name: "user_id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // NOT recommended for production environments
    });

    const jobDescriptionsTable = new dynamodb.Table(this, "JobDescriptionsTable", {
      partitionKey: { name: "user_id", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "job_id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
```

(Only the `partitionKey.name` values change, from `"email"` to `"user_id"`.)

- [ ] **Step 2: Synth to check for errors**

Run: `cd infra && npx cdk synth InfraStack > /dev/null`
Expected: no errors. `cdk diff` will show both tables being replaced (partition key changes are not an in-place update in DynamoDB) — expected and acceptable per the spec's migration section, since there is only one real item in each table right now.

- [ ] **Step 3: Commit**

```bash
git add infra/lib/infra-stack.ts
git commit -m "Rename DynamoDB partition key from email to user_id"
```

(Do not deploy yet — deploy happens once with the Lambda changes below, in Task 15, so the table replacement and the Lambda code that expects the new key land together.)

---

### Task 11: `profile-service` — derive `user_id` from the JWT

**Files:**
- Modify: `infra/lambda/profile-service/index.py`

**Interfaces:**
- Produces: `get_user_id(event) -> str`, used identically in Tasks 12 and 13.

- [ ] **Step 1: Add the identity helper**

Add near the top of `infra/lambda/profile-service/index.py`, after `get_table()`:

```python
def get_user_id(event):
    """The verified Cognito sub for the caller -- the only trustworthy source
    of identity. Never derive this from the request body/query string; a
    client-supplied value there is exactly the vulnerability this replaces."""
    return event["requestContext"]["authorizer"]["jwt"]["claims"]["sub"]
```

- [ ] **Step 2: Update `normalize_profile_payload`, `get_profile_by_email`, and `save_profile`**

Replace `normalize_profile_payload` (email is no longer required — it's just a normal, optional display attribute now) with:

```python
def normalize_profile_payload(data):
    email = data.get("email")
    full_name = data.get("full_name")

    return {
        "full_name": full_name.strip() if isinstance(full_name, str) else "",
        "email": email.strip().lower() if isinstance(email, str) else "",
        "skills": normalize_string_list(data.get("skills")),
        "projects": normalize_entry_list(data.get("projects"), ["name", "period", "description"]),
        "experience": normalize_entry_list(data.get("experience"), ["title", "company", "period", "description"]),
        "education": normalize_entry_list(data.get("education"), ["institution", "degree", "period", "description"]),
    }
```
(unchanged body — email is still normalized the same way, just no longer treated as required anywhere downstream).

Replace `get_profile_by_email` with:

```python
def get_profile_by_user_id(table, user_id):
    return table.get_item(Key={"user_id": user_id}).get("Item")
```

Replace `save_profile` with:

```python
def save_profile(table, user_id, normalized_profile):
    existing = get_profile_by_user_id(table, user_id) or {}

    projects, project_warnings = attach_embeddings(
        normalized_profile["projects"], existing.get("projects", []), ["name", "description"]
    )
    experience, experience_warnings = attach_embeddings(
        normalized_profile["experience"], existing.get("experience", []), ["title", "company", "description"]
    )

    item = {
        "user_id": user_id,
        "email": normalized_profile["email"],
        "full_name": normalized_profile["full_name"],
        "skills": normalized_profile["skills"],
        "projects": projects,
        "experience": experience,
        "education": normalized_profile["education"],
        "created_at": existing.get("created_at", now_iso()),
        "updated_at": now_iso(),
    }
    table.put_item(Item=item)
    return item, project_warnings + experience_warnings
```

- [ ] **Step 3: Update `handler`**

Replace the GET and PUT branches inside `handler`:

```python
        if event.get("rawPath") == "/profile" and http_method == "GET":
            user_id = get_user_id(event)
            profile = get_profile_by_user_id(table, user_id)

            if not profile:
                return response(404, {"error": "Profile not found"})

            return response(200, strip_embeddings(profile))

        if event.get("rawPath") == "/profile" and http_method == "PUT":
            body = event.get("body")
            data = json.loads(body) if body else {}

            user_id = get_user_id(event)
            normalized_profile = normalize_profile_payload(data)

            item, embedding_warnings = save_profile(table, user_id, normalized_profile)

            result = {"message": "Profile saved successfully", **strip_embeddings(item)}
            if embedding_warnings:
                result["embedding_warnings"] = embedding_warnings

            return response(200, result)
```
(This removes the `email query parameter is required` / `email is required` 400 checks entirely — there is no longer a client-supplied identity field to validate.)

- [ ] **Step 4: Verify it parses**

Run: `python3 -m py_compile infra/lambda/profile-service/index.py`
Expected: no output (success).

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/profile-service/index.py
git commit -m "profile-service: derive identity from the JWT sub, not client email"
```

---

### Task 12: `job-service` — derive `user_id` from the JWT

**Files:**
- Modify: `infra/lambda/job-service/index.py`

- [ ] **Step 1: Add the identity helper**

Add after `get_table()` in `infra/lambda/job-service/index.py`:

```python
def get_user_id(event):
    """See profile-service's get_user_id -- same convention."""
    return event["requestContext"]["authorizer"]["jwt"]["claims"]["sub"]
```

- [ ] **Step 2: Rename `email` to `user_id` throughout the data-access functions**

Replace `write_job_description` through `list_job_descriptions` with:

```python
def write_job_description(table, user_id, job_id, company_name, job_title, raw_description, created_at):
    warnings = []

    try:
        embedding = embed_text(raw_description, job_id)
    except Exception as exc:
        print(f"embed_text failed for job_id {job_id!r}: {exc}")
        embedding = None
        warnings.append("raw_description: embedding failed, will be computed on the fly when this job is used for tailoring")

    item = {
        "user_id": user_id,
        "job_id": job_id,
        "company_name": company_name,
        "job_title": job_title,
        "raw_description": raw_description,
        "embedding": embedding,
        "created_at": created_at,
    }
    table.put_item(Item=item)
    return item, warnings


def save_job_description(table, user_id, company_name, job_title, raw_description):
    job_id = str(uuid.uuid4())
    return write_job_description(
        table, user_id, job_id, company_name, job_title, raw_description, now_iso()
    )


def update_job_description(table, user_id, job_id, company_name, job_title, raw_description):
    existing = get_job_description_by_id(table, user_id, job_id)
    if not existing:
        return None

    if raw_description == existing.get("raw_description"):
        item = dict(existing)
        item["company_name"] = company_name
        item["job_title"] = job_title
        item["raw_description"] = raw_description
        table.put_item(Item=item)
        return item, []

    return write_job_description(
        table,
        user_id,
        job_id,
        company_name,
        job_title,
        raw_description,
        existing.get("created_at") or now_iso(),
    )


def get_job_description_by_id(table, user_id, job_id):
    return table.get_item(Key={"user_id": user_id, "job_id": job_id}).get("Item")


def list_job_descriptions(table, user_id):
    result = table.query(KeyConditionExpression=Key("user_id").eq(user_id))
    items = result.get("Items", [])
    items.sort(key=lambda item: item.get("created_at", ""), reverse=True)
    return [strip_embedding(item) for item in items]
```

- [ ] **Step 3: Update `handler`**

Replace the three route branches inside `handler`:

```python
        if raw_path == "/job-description/list" and http_method == "GET":
            user_id = get_user_id(event)
            return response(200, {"job_descriptions": list_job_descriptions(table, user_id)})

        if raw_path == "/job-description" and http_method == "GET":
            query_params = event.get("queryStringParameters") or {}
            job_id = query_params.get("job_id")
            user_id = get_user_id(event)

            if not job_id:
                return response(400, {"error": "job_id query parameter is required"})

            job_description = get_job_description_by_id(table, user_id, job_id)

            if not job_description:
                return response(404, {"error": "Job description not found"})

            return response(200, strip_embedding(job_description))

        if raw_path == "/job-description" and http_method == "PUT":
            body = event.get("body")
            data = json.loads(body) if body else {}

            user_id = get_user_id(event)
            company_name = (data.get("company_name") or "").strip()
            job_title = (data.get("job_title") or "").strip()
            raw_description = (data.get("raw_description") or "").strip()
            job_id = (data.get("job_id") or "").strip() or None

            if not company_name:
                return response(400, {"error": "company_name is required"})
            if not job_title:
                return response(400, {"error": "job_title is required"})
            if not raw_description:
                return response(400, {"error": "raw_description is required"})

            if job_id is not None:
                updated = update_job_description(
                    table, user_id, job_id, company_name, job_title, raw_description
                )
                if updated is None:
                    return response(404, {"error": "Job description not found"})
                item, embedding_warnings = updated
                message = "Job description updated successfully"
            else:
                item, embedding_warnings = save_job_description(
                    table, user_id, company_name, job_title, raw_description
                )
                message = "Job description saved successfully"

            result = {
                "message": message,
                "job_id": item["job_id"],
                "company_name": company_name,
                "job_title": job_title,
            }
            if embedding_warnings:
                result["embedding_warnings"] = embedding_warnings

            return response(200, result)
```
(Note: the response no longer echoes back an `email` field — `api/backend.ts`'s `saveJobDescription`/`updateJobDescription` in Task 14 stop reading `data.email` accordingly.)

- [ ] **Step 4: Verify it parses**

Run: `python3 -m py_compile infra/lambda/job-service/index.py`
Expected: no output (success).

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/job-service/index.py
git commit -m "job-service: derive identity from the JWT sub, not client email"
```

---

### Task 13: `tailoring-service` — derive `user_id` from the JWT

**Files:**
- Modify: `infra/lambda/tailoring-service/index.py`

- [ ] **Step 1: Add the identity helper**

Add after `job_descriptions_table()`:

```python
def get_user_id(event):
    """See profile-service's get_user_id -- same convention."""
    return event["requestContext"]["authorizer"]["jwt"]["claims"]["sub"]
```

- [ ] **Step 2: Rename the lookup functions**

Replace:

```python
def get_profile_by_email(email):
    """Read-only lookup — this service never writes to ProfilesTable."""
    return profiles_table().get_item(Key={"email": email}).get("Item")


def get_job_description_by_id(email, job_id):
    """Read-only lookup — this service never writes to JobDescriptionsTable."""
    return job_descriptions_table().get_item(Key={"email": email, "job_id": job_id}).get("Item")
```

with:

```python
def get_profile_by_user_id(user_id):
    """Read-only lookup — this service never writes to ProfilesTable."""
    return profiles_table().get_item(Key={"user_id": user_id}).get("Item")


def get_job_description_by_id(user_id, job_id):
    """Read-only lookup — this service never writes to JobDescriptionsTable."""
    return job_descriptions_table().get_item(Key={"user_id": user_id, "job_id": job_id}).get("Item")
```

- [ ] **Step 3: Update `handle_tailor_preview`**

Replace the body of `handle_tailor_preview` up to (not including) the keyword-scoring lines:

```python
def handle_tailor_preview(event):
    """POST /tailor-preview: fast, free, keyword-only match between an
    already-saved profile and an already-saved job description. Zero Bedrock
    calls — meant to be cheap enough to call frequently (e.g. as the user
    edits their profile)."""
    body = event.get("body")
    data = json.loads(body) if body else {}

    user_id = get_user_id(event)
    job_id = data.get("job_id")

    if not job_id:
        return response(400, {"error": "job_id is required"})

    profile = get_profile_by_user_id(user_id)
    if not profile:
        return response(404, {"error": "Profile not found"})

    job_description = get_job_description_by_id(user_id, job_id)
    if not job_description:
        return response(404, {"error": "Job description not found"})

    extracted_requirements = extract_requirements_from_raw_description(job_description["raw_description"])
    matched_projects = score_projects(profile, extracted_requirements)
    matched_experiences = score_experience(profile, extracted_requirements)
    prompt_context = build_prompt_context(profile, job_description, matched_projects, matched_experiences)

    return response(
        200,
        {
            "message": "Tailor preview data loaded successfully",
            "job_id": job_id,
            "extracted_requirements": extracted_requirements,
            "matched_projects": matched_projects,
            "matched_experiences": matched_experiences,
            "prompt_context": prompt_context,
        },
    )
```

- [ ] **Step 4: Update `handle_tailor_generate`**

Replace the body of `handle_tailor_generate`:

```python
def handle_tailor_generate(event):
    """POST /tailor-generate: the full pipeline. Accepts either a saved
    {job_id} or an ad-hoc {company_name, job_title, raw_description} that's
    never persisted. Matching is pure embedding similarity (no keyword
    component — see score_entries_with_semantics), then calls Bedrock, which
    reads the actual JD text directly, to produce an actual tailored CV
    section."""
    data = json.loads(event.get("body") or "{}")
    user_id = get_user_id(event)

    profile = get_profile_by_user_id(user_id)
    if not profile:
        return response(404, {"error": "Profile not found"})

    if data.get("job_id"):
        # Saved-job path: reuse the JD's cached embedding if it has one,
        # otherwise embed it now (covers JDs saved before embeddings existed).
        job_description = get_job_description_by_id(user_id, data["job_id"])
        if not job_description:
            return response(404, {"error": "Job description not found"})
        jd_vector = to_float_vector(job_description.get("embedding")) or safe_embed_text(
            job_description["raw_description"], data["job_id"]
        )
    else:
        # Ad-hoc path: nothing saved, nothing cached — embed it fresh.
        missing = [field for field in ("company_name", "job_title", "raw_description") if not data.get(field)]
        if missing:
            return response(400, {"error": f"{missing[0]} is required when job_id is omitted"})
        job_description = {key: data[key] for key in ("company_name", "job_title", "raw_description")}
        jd_vector = safe_embed_text(job_description["raw_description"], "(ad-hoc job)")

    matched_projects = score_projects_with_semantics(profile, jd_vector)
    matched_experiences = score_experience_with_semantics(profile, jd_vector)
    prompt_context = build_prompt_context(profile, job_description, matched_projects, matched_experiences)

    try:
        generated_cv = call_bedrock_for_tailoring(prompt_context)
    except json.JSONDecodeError:
        return response(502, {"error": "Model returned invalid JSON"})
    except ClientError as exc:
        return response(502, {"error": f"Bedrock call failed: {exc.response['Error']['Code']}"})

    return response(
        200,
        {
            "message": "Tailored CV generated",
            "prompt_context": prompt_context,
            "generated_cv": generated_cv,
        },
    )
```

(`build_prompt_context`'s `candidate.email` field is unaffected — it still reads `profile.get("email", "")` from the stored profile item, which Task 11 keeps populated.)

- [ ] **Step 5: Verify it parses**

Run: `python3 -m py_compile infra/lambda/tailoring-service/index.py`
Expected: no output (success).

- [ ] **Step 6: Commit**

```bash
git add infra/lambda/tailoring-service/index.py
git commit -m "tailoring-service: derive identity from the JWT sub, not client email"
```

---

### Task 14: Frontend — drop `email`/`user_id` from every API call

**Files:**
- Modify: `dashboard/src/api/backend.ts`
- Modify: `dashboard/src/pages/ProfileIntakePage.tsx`
- Modify: `dashboard/src/pages/JobDescriptionPage.tsx`
- Modify: `dashboard/src/pages/CVBuilderPage.tsx`

**Interfaces:**
- Consumes: Tasks 11-13's Lambda changes (no `email` request field is read for lookups anymore).
- Produces: new signatures — `getProfile(): Promise<StoredProfile>`, `saveProfile(profile: Profile & { email: string }): Promise<StoredProfile>`, `saveJobDescription(job: JobDescriptionInput): Promise<StoredJobDescription>`, `updateJobDescription(jobId: string, job: JobDescriptionInput): Promise<StoredJobDescription>`, `listJobDescriptions(): Promise<StoredJobDescription[]>`, `tailorPreview(jobId: string): Promise<TailorPreviewResult>`, `generateTailoredCV(jobId: string): Promise<{ prompt_context: PromptContext; generated_cv: GeneratedCV }>`.

- [ ] **Step 1: Update `api/backend.ts`'s function signatures**

Replace `getProfile` through `generateTailoredCV` with:

```ts
/** Fetch the signed-in user's saved profile. Throws on 404. */
export async function getProfile(): Promise<StoredProfile> {
  return request<StoredProfile>('/profile');
}

/** Create or fully replace the signed-in user's profile. `email` is stored
 * as a normal display attribute now — it plays no role in identifying whose
 * profile this is; the backend derives that from the caller's JWT. */
export async function saveProfile(profile: Profile & { email: string }): Promise<StoredProfile> {
  return request<StoredProfile>('/profile', {
    method: 'PUT',
    body: JSON.stringify(profile),
  });
}
```

```ts
export interface JobDescriptionInput {
  company_name: string;
  job_title: string;
  raw_description: string;
}

export interface StoredJobDescription extends JobDescriptionInput {
  job_id: string;
  created_at: string;
}

/** Save a new job description. Always creates a new item — there's no
 * update-in-place or dedup, so re-saving the same posting makes a second copy. */
export async function saveJobDescription(job: JobDescriptionInput): Promise<StoredJobDescription> {
  const data = await request<{ message: string; job_id: string; company_name: string; job_title: string }>(
    '/job-description',
    {
      method: 'PUT',
      body: JSON.stringify(job),
    },
  );
  return { ...job, job_id: data.job_id, created_at: new Date().toISOString() };
}

/** Update an existing job description in place. `job_id` is preserved, so any
 * previously tailored result still points at the same job. */
export async function updateJobDescription(
  jobId: string,
  job: JobDescriptionInput,
): Promise<StoredJobDescription> {
  const data = await request<{ message: string; job_id: string; company_name: string; job_title: string }>(
    '/job-description',
    {
      method: 'PUT',
      body: JSON.stringify({ job_id: jobId, ...job }),
    },
  );
  return { ...job, job_id: data.job_id, created_at: new Date().toISOString() };
}

/** List every job description the signed-in user has saved, most recent first. */
export async function listJobDescriptions(): Promise<StoredJobDescription[]> {
  const data = await request<{ job_descriptions: StoredJobDescription[] }>('/job-description/list');
  return data.job_descriptions;
}
```

```ts
/** Free keyword-only matching preview — unlike /tailor-generate this makes no
 * Bedrock calls, so it's safe to run often (e.g. as the user edits). */
export async function tailorPreview(jobId: string): Promise<TailorPreviewResult> {
  return request('/tailor-preview', {
    method: 'POST',
    body: JSON.stringify({ job_id: jobId }),
  });
}

/** Run the full matching + Bedrock generation pipeline against a saved job. */
export async function generateTailoredCV(
  jobId: string,
): Promise<{ prompt_context: PromptContext; generated_cv: GeneratedCV }> {
  return request('/tailor-generate', {
    method: 'POST',
    body: JSON.stringify({ job_id: jobId }),
  });
}
```

Also update the two interfaces these reference: remove `email: string;` from `StoredProfile` (it's already carried by the `email: string` intersection on `saveProfile`'s parameter and returned by the backend inside the profile body, so `StoredProfile extends Profile` needs its own `email: string;` field — keep that one; only `TailorPreviewResult` and `PromptContext.candidate` keep their existing `email` fields unchanged, since those describe response *data*, not a request parameter). Concretely: `StoredProfile` keeps `email: string;`; `StoredJobDescription` and `JobDescriptionInput` above have already dropped it (shown in the replacement block); no other interface changes.

- [ ] **Step 2: Update `ProfileIntakePage.tsx`'s call sites**

In `dashboard/src/pages/ProfileIntakePage.tsx`:

Change:
```tsx
    getProfile(email)
```
to:
```tsx
    getProfile()
```

Change:
```tsx
      await saveProfile(email, profile);
```
to:
```tsx
      await saveProfile({ ...profile, email });
```

- [ ] **Step 3: Update `JobDescriptionPage.tsx`'s call sites**

In `dashboard/src/pages/JobDescriptionPage.tsx`, make these five exact replacements:

Change:
```tsx
    listJobDescriptions(email)
```
to:
```tsx
    listJobDescriptions()
```

Change:
```tsx
      const saved = await saveJobDescription(email, {
        company_name: companyName.trim(),
        job_title: jobTitle.trim(),
        raw_description: rawDescription.trim(),
      });
```
to:
```tsx
      const saved = await saveJobDescription({
        company_name: companyName.trim(),
        job_title: jobTitle.trim(),
        raw_description: rawDescription.trim(),
      });
```

Change:
```tsx
      const updated = await updateJobDescription(email, job.job_id, {
        company_name: editForm.company_name.trim(),
        job_title: editForm.job_title.trim(),
        raw_description: editForm.raw_description.trim(),
      });
```
to:
```tsx
      const updated = await updateJobDescription(job.job_id, {
        company_name: editForm.company_name.trim(),
        job_title: editForm.job_title.trim(),
        raw_description: editForm.raw_description.trim(),
      });
```

Change:
```tsx
      const preview = await tailorPreview(email, job.job_id);
```
to:
```tsx
      const preview = await tailorPreview(job.job_id);
```

Change:
```tsx
      const data = await generateTailoredCV(email, job.job_id);
```
to:
```tsx
      const data = await generateTailoredCV(job.job_id);
```

- [ ] **Step 4: Update `CVBuilderPage.tsx`'s call sites**

In `dashboard/src/pages/CVBuilderPage.tsx`:
- `generateTailoredCV(email, viewerJobId)` → `generateTailoredCV(viewerJobId)`
- `getProfile(email).catch(() => null)` → `getProfile().catch(() => null)`

- [ ] **Step 5: Verify it compiles and remove now-dead `email` reads**

Run: `cd dashboard && npx tsc --noEmit`
Expected: any `email` variable that's now unused in a file (no longer passed to any API call, and not used for display or the `!email` sign-in guard) shows as unused — remove those specific declarations. Keep any `email` read that's still used for the existing "you need to sign in first" guard or for display (e.g. `ProfileIntakePage.tsx`'s guard and its `{email}` in the "Saved under {email}" text, and `Shell.tsx`'s header display).

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/api/backend.ts dashboard/src/pages/ProfileIntakePage.tsx dashboard/src/pages/JobDescriptionPage.tsx dashboard/src/pages/CVBuilderPage.tsx
git commit -m "Stop sending email/user id in API requests -- backend derives it from the JWT"
```

---

### Task 15: Deploy, re-enter test data, and verify Phase 3 end-to-end

**Files:** none (deployment + manual verification only)

- [ ] **Step 1: Deploy everything**

Run: `cd infra && npx cdk deploy --require-approval never`
Expected: succeeds. This replaces `ProfilesTable`/`JobDescriptionsTable` (new partition key) and updates all four Lambdas.

- [ ] **Step 2: Re-enter the one existing test profile and job description**

Per the spec's migration section, there's no scripted migration for this small amount of data. Sign in as the real test user (`allanchien@gmail.com` or whichever account was used earlier this session) through the app's Hosted UI flow, re-paste the background text on `/profile`, save it, and re-save the Pounamu Health Technologies (or whichever) job description on `/jobs`.

- [ ] **Step 3: Confirm the full pipeline works under the new schema**

In the browser: generate a tailored CV for that re-entered job. Expected: succeeds, and `matched_projects`/`matched_experiences` in the response still populate correctly (proving `tailoring-service`'s `user_id`-keyed lookups work).

- [ ] **Step 4: Confirm the actual vulnerability is fixed — cross-account check**

Sign up a **second** test user through Hosted UI (different email). Sign in as that user and attempt to view `/profile` — it should show no profile (never see the first user's data), since `user_id` (not a guessable email) now scopes every lookup. This is the concrete proof the original vulnerability (anyone who knows an email can read/write that person's data) is closed.

- [ ] **Step 5: Check CloudWatch logs are clean**

```bash
aws logs tail /aws/lambda/<ProfileServiceHandler-name> --since 10m
aws logs tail /aws/lambda/<JobDescriptionServiceHandler-name> --since 10m
aws logs tail /aws/lambda/<TailoringServiceHandler-name> --since 10m
```
Expected: no unexpected errors/tracebacks (the existing `BEDROCK_USAGE`/`SEMANTIC_SCORE`/`PROMPT_DEBUG` debug lines are expected and fine).

- [ ] **Step 6: Report results and wait for confirmation**

Hand back the exact steps above so they can be reproduced independently. Once confirmed:

- [ ] **Step 7: Update `PLAN.md`**

Change the "Authentication (Cognito)" section's status marker from `🚧 decided, not yet built` to `✅ implemented`, and add a short verification note (mirroring the style of other `✅` sections in `PLAN.md`, e.g. "Verified against the real deployed endpoint: ...").

```bash
git add PLAN.md
git commit -m "Mark Cognito authentication implemented and verified"
git push origin develop
```
