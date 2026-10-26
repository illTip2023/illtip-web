# illtip-web: rules for building features

React 19 web app that mirrors the i'llTip mobile app (React Native, source at /home/claude/illtip-mobile, read-only reference).
It talks to the SAME backend as the app (illtip-backend; source at /home/claude/illtip-backend, read-only reference).

## Hard rules
- NEVER change the backend, the mobile app, or anything outside /home/claude/illtip-web. No new backend endpoints: only use endpoints the mobile app already uses (find them in illtip-mobile/src/services, src/hooks, src/config/api.ts, src/ui/screens).
- Only edit files inside YOUR feature folder `src/features/<feature>/` (you may create any files there, including a `<feature>.css` imported from your routes.tsx). Do NOT edit src/lib/*, src/ui/*, src/main.tsx, src/routes.tsx, src/styles.css, build.mjs, or other features. If you truly need a shared change, put it in your final report instead.
- No npm installs (registry blocked). Only `react` and `react-dom` are available. No react-router, react-query, axios: use our helpers below.
- Do not run anything that calls the live API (the container can't reach it anyway). Never put secrets/tokens in code.
- Public content rules: never show subscription prices or user counts in marketing copy. Show pay only as the API gives it.
- Keep the mobile app's behaviour and wording where sensible (copy i18n strings from illtip-mobile/src/config/i18n English JSON), but make layouts good on desktop (centered column up to ~760px; use `.content.wide` style grids when useful) and on phones.

## Helpers you must use
- `src/lib/api.ts`: `api.get/post/put/patch/delete(path, body?, { params })` → `{ data, status }`; adds Bearer token + refresh on 401. `unwrap(res)` returns `res.data.data` for `{success,message,data}` responses (throws on success:false). Paths are relative to the backend root, e.g. `api.get('/service/v2/fetchServiceRequestList', { params: { page: 1 } })`. Use FormData for uploads (api handles it).
- `src/lib/query.ts`: `useQuery(key, fn)`, `useInfinite(key, fetchPage)` (+ `useOnVisible(loadMore)` sentinel ref for infinite scroll), `invalidate(prefix)`, `setQueryData(key, fn)`.
- `src/lib/router.tsx`: path router (History API, `href()` for raw anchors; old `#/` links still work). `Link`, `navigate(path)`, `goBack(fallback)`, `useParams()`, `useQueryParams()`. Route patterns like `/jobs/:id`.
- `src/lib/auth.tsx`: `useAuth()` → `{ user, session, login, logout, updateUser }`. `user.id` is the logged-in userId.
- `src/lib/images.ts`: `pickDisplayableImageUri(normalizeImageDetails(x))` to turn backend image objects into URLs.
- `src/lib/env.ts`: `API_BASE_URL`, `CHAT_URL`, `APP_LINKS` (store links), `ENV_NAME`.
- `src/ui/kit.tsx`: `Spinner, ErrorBox, Empty, Avatar, PageHeader, Modal, toast.ok/error, Icon, timeAgo, compactNumber`.
- CSS classes in src/styles.css: `.card .list .stack .row .row-wrap .between .grow .btn .btn-ghost .btn-sm .btn-block .btn-dark .input .textarea .select .label .field .chip(.active) .chips .tabs(button.active) .tag .tag-ok .tag-warn .muted .small .tiny .pre .clamp-3 .ellipsis .media .grid-3 .divider .page-header .icon-btn`. Brand colours: var(--navy) #2c4364, var(--blue) #3f4ff5, var(--sky) #5a99f4.

## Your routes
Export `routes: RouteDef[]` from `src/features/<feature>/routes.tsx` (replace the placeholder). `{ path, element, auth? , chrome? }`: everything requires login by default; `chrome: false` renders without the app shell (auth screens). Path ownership is listed in your brief; don't claim other paths.

## Features that need things the web can't do
Payments (Stripe checkout, buying coins, subscriptions), video upload/compression, push notifications, biometrics: show a clear card "Do this in the i'llTip app" with both store links (APP_LINKS) instead of half-building them, unless your brief says otherwise.

## Check before you finish
`cd /home/claude/illtip-web && NODE_PATH=/opt/npm-tools/node_modules node build.mjs && /opt/npm-tools/node_modules/.bin/tsc -p .` must both pass. Do not git commit; the lead commits.
Report: routes added, endpoints used (method + path + which mobile file you took it from), anything stubbed, and any shared change you need.
