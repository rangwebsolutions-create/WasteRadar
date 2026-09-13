# WasteRadar

A gamified, crowdsourced waste-hotspot reporting app for the Agadir, Morocco coastline. Built as a hackathon MVP.

**Live app:** deployed as a static site (`index.html` / `style.css` / `script.js`) plus a Supabase backend. No build step — open `index.html` on any static host.

---

## What it does

- **Report** a waste hotspot by tapping a location on the map and attaching a photo
- **Claim & verify** a cleanup with an "after" photo — a real, client-side pixel comparison against the stored "before" photo produces a genuine visual-change percentage (see [How the AI Scanner actually works](#how-the-ai-scanner-actually-works) below)
- **Leaderboard** and **XP**, per crew (Team Atlas / Beach Guardians / Desert Rovers)
- **English / French / Arabic**, with right-to-left layout for Arabic
- Installable as a PWA

No accounts, no email, no password — crew selection and an optional display name are stored in `localStorage` only. This is intentionally a placeholder identity layer for the demo, not real auth.

---

## Required Supabase setup

The app expects a table named `hotspots`. Run the following once, in the Supabase dashboard's **SQL Editor** (paste, click Run):

```sql
-- Adds photo storage and per-crew leaderboard attribution.
-- Safe to run more than once.
alter table hotspots
  add column if not exists photo_data text,
  add column if not exists after_photo_data text,
  add column if not exists resolved_by_crew text;

-- CRITICAL: closes a real security hole. The anon key used by this
-- app's frontend is public by design (see Security below), and without
-- this line, anyone can delete every row in the table using nothing
-- more than that key and their browser's devtools.
revoke delete on hotspots from anon;
```

If you haven't run this yet, the app still works — it detects the missing columns/permissions and degrades gracefully (reports and verifications still succeed, just without photo storage or leaderboard attribution until you run it).

---

## Security

**The Supabase anon key in `script.js` is meant to be public.** It's designed by Supabase to be shipped in client-side code, the same way this app does it — protection comes from database-level rules (grants and Row Level Security), not from hiding the key. It cannot be hidden anyway: any key a browser needs to use in plaintext can always be read back out of that browser.

Given that, here's the actual security posture of this app as shipped:

| Operation | Who can do it | Why |
|---|---|---|
| `SELECT` (read hotspots) | Anyone | Needed for the public map/leaderboard to work with no login |
| `INSERT` (report a hotspot) | Anyone | Needed for anonymous reporting — the core feature |
| `UPDATE` (claim/verify a cleanup) | Anyone | Needed for anonymous verification — the core feature |
| `DELETE` | **No one**, once the SQL above is run | There is no way to distinguish "the developer" from "any visitor" without real authentication, so the only safe default is to disable it entirely |

The in-app "Demo Reset" gesture (triple-tap the top-left corner) no longer deletes anything directly — it now just tells you how to clear data from the Supabase dashboard's Table Editor instead. That's a deliberate trade-off: convenience lost, but no publicly-triggerable data-destruction path left in the app.

If you add real authentication later, `DELETE` (and ideally scoping `UPDATE`/`INSERT` to a row's owner) can be reintroduced safely via Row Level Security policies keyed to `auth.uid()`.

---

## How the AI Scanner actually works

There is **no external AI API call anywhere in this app, and no API key for one.** That's intentional: a general-purpose AI API key is unsafe to ship in client-side code the way the Supabase anon key is — it isn't designed to be public, and there's no way to encrypt it that the browser doesn't have to un-encrypt to use it.

Instead, "Run AI Scanner" does a real, local computation: it downsamples the stored "before" photo and the new "after" photo to small canvases and computes the actual pixel-level difference between them. A bigger real difference produces a bigger reported percentage. It's a heuristic, not a trained litter-detection model — it's disclosed as such in this README rather than oversold as something it isn't.

If a hotspot has no "before" photo on file (see the photo upload fixes below — older data or a failed upload can cause this), the scanner falls back to a randomized estimate in a plausible range, and the result screen says so explicitly ("estimated — no baseline photo on file").

---

## Known, honest limitations

- **Severity score** on a new report is a randomized number (1–5), not derived from the photo. There's no real signal in a single photo to reliably estimate severity from client-side code alone; faking one would be less honest than being upfront that it's illustrative.
- **Offline mode is not implemented.** The service worker (`sw.js`) exists only so the browser will offer to install the app as a PWA — it deliberately does not cache anything, so if the network drops, the app doesn't function. This was a conscious choice to avoid risking a stale cached build during active development; a real caching strategy is future work.
- **GPS proximity check is informational, not enforced.** When verifying a cleanup, the app checks and displays how far you are from the hotspot, but never blocks submission. A hard block would make the app impossible to demo or judge from outside Agadir.
- **Photo size**: photos are resized and compressed client-side before storage (long edge capped, JPEG re-encoded), and rejected upfront if the original file is over 15MB or not an image type — this bounds how large the stored `text` payload can get, but very large numbers of stored photos will still grow the table over time. Fine for a demo; worth reconsidering (e.g. real object storage) for production scale.

---

## Fixed in this pass (photo upload)

Three real bugs were found and fixed in the photo upload flow:

1. `capture="environment"` on both file inputs was restricting mobile browsers to camera-only, contradicting the UI's own "Tap to open camera or gallery" text, and behaving unpredictably in in-app browsers (Instagram/Facebook/LinkedIn webviews) and on desktop. Removed — inputs now use a plain `accept="image/*"` and let the browser offer its normal full picker.
2. Both upload `<label>` elements had *both* an explicit `for="..."` attribute *and* the associated `<input>` nested inside them. That double-association is a known cause of the file picker opening and immediately self-cancelling on iOS Safari and some Android browsers. Fixed by keeping only the implicit (nesting) association.
3. A selected photo now shows an actual thumbnail preview, not just a text/icon swap — and failures (invalid file type, oversized file, or a processing error) now show a clear on-screen message instead of failing silently while telling the user the report succeeded.

---

## Local development

No build step. Serve the three files (`index.html`, `style.css`, `script.js`) plus `manifest.json`, `sw.js`, and the icon files from any static host or local server. Supabase URL and anon key are set directly in `script.js`.
