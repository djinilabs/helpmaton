# Scrape implementation: ways to reduce blocking

When the scrape provider is used with URLs that enforce strong anti-bot measures (e.g. **www.reddit.com**), the server may receive a block page (e.g. “You've been blocked by network security…”) instead of the real content. This document lists changes we can make **only in our own scrape implementation** (no proxy-provider or third-party changes) to reduce the chance of being blocked.

---

## 1. Align Lambda browser args with local (stealth)

**Current:** In **local** dev, `puppeteerBrowser.ts` passes `--disable-blink-features=AutomationControlled` so the browser looks less like automation. In **Lambda**, we use `@sparticuz/chromium`’s default args and only add `--proxy-server=...`; we do **not** add that flag there.

**Change:** When launching in Lambda, append the same stealth-related flags we use locally (at least `--disable-blink-features=AutomationControlled`) so production matches local behavior and is less detectable.

**Files:** `apps/backend/src/utils/puppeteerBrowser.ts`

---

## 2. Relax or skip resource blocking for “sensitive” domains

**Current:** We call `setupResourceBlocking(page)` for every URL. That blocks images, CSS, fonts, media, subframes, and many tracker domains. Pages then load without styles and with a different resource profile than a normal browser.

**Why it can cause blocking:** Sites (and WAFs) often treat “no CSS / no images” as a strong bot signal. Reddit and similar sites may block or challenge such traffic.

**Change (options):**

- **Option A:** For known strict domains (e.g. `www.reddit.com`, `old.reddit.com`), **skip** `setupResourceBlocking` so the page loads like a normal browser (full CSS, images, etc.). Other URLs keep current behavior.
- **Option B:** Relax blocking globally (e.g. allow CSS and fonts, block only heavy media or a smaller tracker list) so pages look more “real” while still saving bandwidth. Tune per risk/cost.

**Files:** `apps/backend/src/http/post-api-scrape/index.ts`, optionally `apps/backend/src/utils/puppeteerResourceBlocking.ts` (e.g. allowlist or domain-aware behavior).

---

## 3. Set realistic HTTP headers per page

**Current:** We don’t set `User-Agent`, `Accept-Language`, `sec-ch-ua`, or other headers in the scrape handler. We rely on default Chromium and puppeteer-extra-plugin-stealth.

**Change:** Before `page.goto(url)`, call `page.setExtraHTTPHeaders()` with a consistent, browser-like set for the target origin, e.g.:

- `Accept-Language: en-US,en;q=0.9`
- Optional: a single, modern Chrome-like `User-Agent` (if not already overridden by stealth in a way we want to keep)
- Optional: `sec-ch-ua` / `sec-ch-ua-mobile` / `sec-ch-ua-platform` to match the viewport and UA

This makes the request look more like a real browser and can help with WAF/geo rules.

**Files:** `apps/backend/src/http/post-api-scrape/index.ts` (before `page.goto`).

---

## 4. Use a stable, desktop viewport in all environments

**Current:** In Lambda we don’t call `page.setViewport()` in the scrape handler (we rely on `defaultViewport` from the browser). Locally we set `{ width: 1920, height: 1080 }` only when **not** in Lambda.

**Change:** Always set the same desktop viewport in the scrape handler (e.g. 1920×1080) after creating the page, in both Lambda and local. This avoids odd viewport-based fingerprinting and matches a common “desktop” profile.

**Files:** `apps/backend/src/http/post-api-scrape/index.ts`.

---

## 5. Reddit-specific: try old Reddit or desktop variant

**Current:** We navigate to the URL as given (e.g. `https://www.reddit.com/...`). Reddit’s newer web app is heavily JS-based and often more protected.

**Change:** For hostnames like `www.reddit.com`, optionally rewrite the URL to `old.reddit.com` (same path) so we hit the classic, lighter page. Alternatively, ensure we request the “desktop” version (e.g. via headers or query param if Reddit supports it). This is a **heuristic** and may work better for some blocks; document that it’s best-effort.

**Files:** `apps/backend/src/http/post-api-scrape/index.ts` (URL normalization before `page.goto`).

---

## 6. Detect block page and fail or retry instead of returning it as content

**Current:** If the server returns a block page (e.g. “You've been blocked by network security…”), we still return HTTP 200 and send that page’s AOM as the tool result. The agent then “succeeds” with useless content.

**Change:**

- After extracting AOM (or a short text snapshot), check for known block phrases (e.g. “blocked by network security”, “file a ticket”, “checking your browser”, “access denied”, “captcha” in prominent text).
- If detected:
  - **Option A:** Return a clear error to the agent (e.g. “Content could not be loaded: the server returned a block/security page. Try another URL or provider.”) and optionally consume the scrape as a failed attempt for billing.
  - **Option B:** Retry once (e.g. different proxy, or same proxy with small delay and optional header/viewport tweaks), then if still blocked, return the same clear error.

This doesn’t prevent blocking but improves behavior: the agent gets an explicit failure instead of confusing “content” that says the user is blocked.

**Files:** `apps/backend/src/http/post-api-scrape/index.ts` (after `extractAOM` / before sending response), and optionally `apps/backend/src/http/utils/tavilyTools.ts` if we want to map scrape errors to a specific tool message.

---

## 7. Retry with a different proxy on block detection

**Current:** We pick one random proxy from `DECODO_PROXY_URLS` and use it for the whole request. If that proxy (or the path through it) is blocked, we don’t try another.

**Change:** If we implement block-page detection (see §6), on first “block” we can retry the same URL once with a **different** randomly chosen proxy (and optionally the same or slightly different headers/viewport). If the second attempt also returns a block page, then return the clear error. This only uses existing proxy URLs; no new infra.

**Files:** `apps/backend/src/http/post-api-scrape/index.ts` (retry loop with proxy reselection).

---

## 8. Small delay before navigation / human-like timing

**Current:** We navigate as soon as the page is set up. Some systems treat “instant” navigation after page creation as automated.

**Change:** Add a short delay (e.g. 1–3 seconds) after creating the page and before `page.goto(url)`, and optionally a short delay before starting the Reddit hydration wait. Prefer only for known strict domains to avoid slowing every scrape. Can be combined with random jitter (e.g. 1–2 s + random 0–1 s).

**Files:** `apps/backend/src/http/post-api-scrape/index.ts`.

---

## 9. Set referrer for same-site navigation (e.g. Reddit)

**Current:** We don’t set a referrer; the browser sends its default (often empty or the scrape endpoint origin).

**Change:** For Reddit (and optionally other strict sites), set a referrer so the request looks like internal navigation, e.g. `https://www.reddit.com/` or `https://old.reddit.com/` when navigating to a Reddit URL. Use `page.setExtraHTTPHeaders({ 'Referer': '...' })` before `goto`. Some WAFs are less strict when the referrer is the same site.

**Files:** `apps/backend/src/http/post-api-scrape/index.ts`.

---

## 10. Ensure stealth and captcha config are loaded in scrape path

**Current:** Stealth is applied via `puppeteerConfig.ts`, which is loaded when `puppeteerBrowser` imports `getChromium` from it. So when we launch the browser for scrape, stealth should already be active. No code change needed if this stays the case.

**Recommendation:** Keep the scrape handler using the same `launchBrowser` that pulls in `puppeteerConfig` (so stealth and any reCAPTCHA plugin remain in effect). If we ever split or lazy-load the browser, ensure the scrape path still loads and applies `configurePuppeteer()` before first `puppeteer.launch()`.

---

## Summary table

| # | Change | Effect | Risk / cost |
|---|--------|--------|-------------|
| 1 | Add stealth args in Lambda | Same as local; less automation signal | Low |
| 2 | Skip or relax resource blocking for Reddit (or strict domains) | Page loads like real browser | Medium (more bandwidth); allowlist keeps others unchanged |
| 3 | Set Accept-Language and optional headers | More realistic request | Low |
| 4 | Set viewport consistently in all envs | Stable fingerprint | Low |
| 5 | Reddit → old.reddit.com (or desktop) | Lighter, sometimes less protected page | Low (heuristic) |
| 6 | Detect block page and return error (or retry) | Agent gets clear failure instead of block-page “content” | Low |
| 7 | Retry with different proxy on block | Second chance without new infra | Low (one extra attempt) |
| 8 | Short delay before goto | Slightly more human-like timing | Medium (adds latency) |
| 9 | Set Referer for Reddit | Same-site navigation signal | Low |
| 10 | Verify stealth loaded in scrape path | No regression | None |

Implementing **1, 3, 4, 6, and 9** gives quick wins with little downside. Adding **2** (for Reddit or strict domains) and **5** can directly target Reddit. **7** and **8** are optional refinements.
