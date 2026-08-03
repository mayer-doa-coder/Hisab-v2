# SECURITY.md

**Owner:** A · **Scope:** requirement 6 (protecting the user's own and sensitive data) and requirement 12 (app security)

This is a checklist, not an essay. Every item is either done or not done. Items marked **[v1]** are things the previous version got wrong; those are the ones most likely to come back.

---

## 1. Threat model

Who we are defending against, in order of realistic likelihood:

1. **Someone who picks up or steals the phone.** By far the most likely. The shopkeeper's phone sits on a counter all day.
2. **Another app on the device**, or someone with ADB access, reading our database file.
3. **Someone who downloads the APK** and unzips it looking for secrets. **[v1]** — this succeeded against v1.
4. **A network attacker** on shared or hostile Wi-Fi.
5. **A malicious or compromised client** submitting fabricated events to the sync endpoint.
6. **Us** — leaking customer PII into logs, crash reports, or a third-party analytics SDK.

Explicitly **out** of scope for v2: a determined attacker with physical access and unlimited time on a rooted device. Full-disk-level defence against that is not achievable in an app and pretending otherwise wastes effort.

---

## 2. At rest, on the device

- [ ] **SQLite encrypted with SQLCipher.** The key is derived from the user's PIN with Argon2id (or PBKDF2 with a high iteration count if Argon2 is impractical in the RN setup). The salt lives in Android Keystore. **The key is never written to disk in plaintext.** **[v1: database was plaintext]**
- [ ] **Changing the PIN re-keys the database.** Test this path; it is easy to get wrong and silently lose data.
- [ ] **Nothing sensitive in `AsyncStorage`** — it is unencrypted. Tokens, keys, and the device id go in `expo-secure-store`, backed by Android Keystore.
- [ ] **Photos in app-internal scoped storage**, never in shared media directories where the gallery and other apps can read them.
- [ ] **`android:allowBackup="false"`** so ADB backup cannot extract the database.
- [ ] **`FLAG_SECURE`** on screens showing balances, the customer list, and customer detail. Blocks screenshots and screen recording, and blanks the app in the recents switcher.
- [ ] **Auto-lock after inactivity.** The phone sits on a counter. Default 5 minutes; make it configurable, not disableable.

---

## 3. In transit

- [ ] **TLS only.** Reject plaintext HTTP in every build configuration that could ship. Set `android:usesCleartextTraffic="false"`.
- [ ] **Certificate pinning** on the API domain, with a documented rotation plan so a certificate change doesn't brick installed apps.
- [ ] **No third-party API key in the client, ever.** **[v1: `EXPO_PUBLIC_ASSEMBLYAI_KEY` shipped in the bundle]** Any `EXPO_PUBLIC_*` variable is inlined into the JS bundle and readable by anyone who unzips the APK. Third-party services are called from `server/`. The client calls our server.
- [ ] The **only** permitted `EXPO_PUBLIC_*` variable is `EXPO_PUBLIC_API_BASE_URL`. This is checked in CI by grepping the bundle.

> If you are reading this and the v1 AssemblyAI key was real: **rotate it now.** It has been public in a public repository.

---

## 4. Authentication

- [ ] **PIN hashed server-side** with bcrypt or Argon2. Never stored in plaintext or reversibly on the device.
- [ ] **Refresh tokens bound to a device fingerprint and rotated on every use.** Use from a different fingerprint revokes the entire token family and writes a security event. (v1's plan got this right — carry it forward.)
- [ ] **Rate-limited PIN attempts** with exponential lockout, enforced locally *and* server-side.
- [ ] **Phone number, not email, as the primary identifier.** Email verification as a gate before first use is wrong for this population. **[v1: signup → email verification → PIN setup before the app was usable]**
- [ ] **No PIN or secret accepted by voice.** **[v1: `WAIT_PIN` FSM state with a 1.00 confidence threshold]** Confidence protects against mis-transcription; it does not protect against the customer standing eighteen inches away.
- [ ] **No stubbed auth endpoints in `main`.** **[v1: `globalIdentity/verify-otp` was "console-log only in current build"]** An endpoint that doesn't verify is an auth bypass. Either it works or it isn't merged.

---

## 5. Server

- [ ] Zod validation on every request body before the handler runs.
- [ ] Events validated **semantically**, not just structurally, before commit: a payment cannot exceed the outstanding balance beyond a rounding tolerance; a stock-out cannot take quantity below zero.
- [ ] Per-user, per-event-type mutation rate envelopes. A legitimate shop does not create 5,000 credit events in a day; anomalous volume is a reliable signal.
- [ ] Batch size cap on the push endpoint, with a byte limit per event.
- [ ] Idempotency comes free from device-generated UUIDs plus `INSERT ... ON CONFLICT (id) DO NOTHING`. **No idempotency hash table, no 24-hour TTL, no `IdempotencyRecord` model.** **[v1 had all three]**
- [ ] A shop can only ever read or write events for its own `shop_id`. Enforced in the query, not in application logic that can be forgotten.
- [ ] Helmet, strict CORS allow-list in production, and request size limits.

---

## 6. Data minimisation — the part most projects skip

- [ ] **Collect only what a shipped feature uses.** `CUSTOMER_ADDED` requires exactly one field: `display_name`. Phone is optional. **[v1's customer form asked for name, phone, address, credit limit, and due terms for someone standing at a counter.]** Address in particular is a liability with no clear use.
- [ ] **Reconsider photo capture entirely.** Photographing a person as proof of a debt stores biometric-adjacent data about a third party who never installed the app and never consented. If it ships at all: opt-in per entry, never a default, deletable by the shopkeeper, and never synced to the server.
- [ ] **No PII in logs, crash reports, or telemetry.** Log ids. Never names, phone numbers, or amounts tied to an identity.
- [ ] **No third-party analytics SDK.** Our own endpoint, sending event counts and timings, never content.
- [ ] **No cross-shop data sharing.** See `AGENTS.md` §4.7. The customer is not a user of this app and has consented to nothing.

---

## 7. Third-party data subjects

This deserves its own section because it is the ethically distinctive part of the product.

The people whose financial history the app records — the customers who owe baki — **are not users of this app.** They did not install it, did not agree to terms, and in most cases do not know it exists. Their name, phone number, and debt history are being stored by someone else.

That imposes obligations beyond ordinary app security:

- [ ] Data stays on the shopkeeper's device and our server, and goes nowhere else.
- [ ] The customer-facing view exists so the customer can *see* their own record — this preserves the mutual visibility that makes a paper ledger socially trusted.
- [ ] `CUSTOMER_ARCHIVED` with `reason: 'REQUESTED'` is the erasure path when a customer asks not to be recorded. The shopkeeper must be able to find and use it.
- [ ] Risk framing is never visible to the customer. Facts, not scores. **[v1 had a colour-coded `CustomerRiskBadge` on the customer list row]**
- [ ] **Verify the current status of Bangladesh's data protection law before the pilot.** The regime has been in flux and this document does not assert what it currently says. Also check Bangladesh Bank's regulatory perimeter for anything resembling credit information sharing, and the remit of the Credit Information Bureau, before considering any cross-shop feature.

---

## 8. Pilot-specific

- [ ] Written consent from each shopkeeper, **in Bengali**, explaining what is collected, where it goes, and how to withdraw.
- [ ] A documented, tested way for a shopkeeper to export all their data and to delete all of it.
- [ ] University ethics / IRB approval. Start during Phase 0 — approval can take weeks.
- [ ] Telemetry is opt-in, explained in plain Bengali, and separately revocable from the app itself.

---

## 9. CI checks

Automated, so these cannot regress silently:

- [ ] Secret scanning on every push (GitHub secret scanning + `gitleaks`)
- [ ] Bundle grep: fail if any `EXPO_PUBLIC_*` other than `EXPO_PUBLIC_API_BASE_URL` appears in the built bundle
- [ ] `npm audit --audit-level=high` on the server
- [ ] Dependency review on pull requests
- [ ] A test asserting no `console.log` reaches a release build

---

## 10. Reporting a vulnerability

This is a student project, not a funded product. If you find a security issue, open a GitHub issue with the `security` label, or contact the maintainers directly if the issue is sensitive. There is no bounty and no formal SLA, but reports are taken seriously and credited.
