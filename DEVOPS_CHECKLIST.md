# PenDrops Production-Ready DevOps Checklist
**Senior/2026 Standards** | Generated: 2026-09-17

---

## 📋 Executive Summary

This checklist covers all DevOps improvements needed to make PenDrops production-ready. Items are prioritized by **Critical (P0)**, **High (P1)**, **Medium (P2)**, **Low (P3)**.

---

## ✅ COMPLETED (This Session)

| Area | Files Created/Modified |
|------|------------------------|
| **CI/CD** | `.github/workflows/ci.yml` (enhanced), `.github/workflows/deploy.yml` (enhanced), `.github/dependency-review-config.yml` |
| **GitHub Pages** | `public/404.html` (SPA fallback), `vite.config.js` (build timestamp, 404 copy) |
| **Security Headers** | `index.html` (CSP, X-Frame-Options, Referrer-Policy, Permissions-Policy) |
| **Secrets Management** | `SECRETS_MANAGEMENT.md` (documentation) |
| **Supabase Config** | `supabase-production-config.sql` (RLS fix, CORS, Realtime, backups) |
| **Monitoring** | `src/monitoring/sentry.ts` (Sentry + Web Vitals), `src/main.ts` (integration) |
| **Performance** | Bundle size check in CI, Lighthouse CI assertions |

---

## 🔴 P0 - CRITICAL (Do Immediately)

### 1. Rotate Exposed Credentials
**Credentials were exposed in chat - MUST ROTATE NOW**

```bash
# 1. Supabase Service Role Key
# Supabase Dashboard → Settings → API → "Reveal service role key" → "Rotate"

# 2. GitHub PAT
# GitHub Settings → Developer settings → Personal access tokens → "Regenerate token"

# 3. Supabase Personal Access Token
# Supabase Dashboard → Account → Access Tokens → "Revoke" → "Generate new token"

# 4. Update GitHub Secrets with new values
gh secret set VITE_SUPABASE_URL --body "https://bnzcfhtmzvxxiwfkdryn.supabase.co" --repo telikuy070-collab/pendrops
gh secret set VITE_SUPABASE_ANON_KEY --body "<new-anon-key>" --repo telikuy070-collab/pendrops
gh secret set SUPABASE_SERVICE_ROLE_KEY --body "<new-service-role-key>" --repo telikuy070-collab/pendrops
gh secret set SUPABASE_ACCESS_TOKEN --body "<new-access-token>" --repo telikuy070-collab/pendrops
gh secret set GITHUB_PAT --body "<new-github-pat>" --repo telikuy070-collab/pendrops
```

### 2. Apply Supabase Production Config
```bash
# Run in Supabase SQL Editor
# File: supabase-production-config.sql
# This fixes RLS (removes anon WRITE), configures CORS, Realtime, backups
```

### 3. Change Default Admin PIN
```sql
-- In Supabase SQL Editor
-- Generate new hash: echo -n 'YOUR_NEW_PINpendrops-salt-2026' | sha256sum
UPDATE public.admin_config
SET pin_hash = 'YOUR_NEW_SHA256_HASH_HERE',
    updated_at = NOW()
WHERE key = 'admin_pin';
```

---

## 🟠 P1 - HIGH (This Week)

### 4. Configure Sentry
```bash
# 1. Create Sentry project at sentry.io
# 2. Get DSN from Settings → Projects → Client Keys
# 3. Add to GitHub Secrets
gh secret set SENTRY_DSN --body "https://xxx@sentry.io/xxx" --repo telikuy070-collab/pendrops
gh secret set SENTRY_AUTH_TOKEN --body "<auth-token>" --repo telikuy070-collab/pendrops

# 4. Add to vite.config.js define for build-time injection
# define: { __SENTRY_DSN__: JSON.stringify(process.env.SENTRY_DSN) }
```

### 5. Enable Supabase PITR (Point-in-Time Recovery)
- Requires **Supabase Pro plan** ($25/month)
- Dashboard → Settings → Database → Backups → Enable PITR
- Set retention: 7-30 days

### 6. Configure Custom Domain (Optional)
```bash
# 1. Add CNAME in DNS: pendrops.yourdomain.com → telikuy070-collab.github.io
# 2. GitHub Pages → Settings → Custom domain → pendrops.yourdomain.com
# 3. Enable "Enforce HTTPS"
# 4. Update Supabase CORS: https://pendrops.yourdomain.com
```

### 7. Verify Git History Clean
```bash
# Check for leaked secrets in history
git log --all --full-history --oneline -- .env
git log --all --full-history --oneline -- "*secret*" -- "*key*" -- "*token*"

# If found, use BFG Repo-Cleaner or git-filter-repo to purge
# Then force push (coordinate with team!)
```

---

## 🟡 P2 - MEDIUM (This Sprint)

### 8. Add Snyk Security Scanning
```bash
# 1. Sign up at snyk.io, connect GitHub repo
# 2. Add SNYK_TOKEN to GitHub Secrets
gh secret set SNYK_TOKEN --body "<snyk-token>" --repo telikuy070-collab/pendrops

# 3. Add to CI (already in ci.yml as comment, uncomment):
# - uses: snyk/actions/node@master
#   env: SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
```

### 9. Set Up Uptime Monitoring
```bash
# Option A: UptimeRobot (free)
# - Add monitor: https://telikuy070-collab.github.io/pendrops/
# - Interval: 5 minutes
# - Alert contacts: email, Slack, Telegram

# Option B: Better Uptime / Cronitor / Healthchecks.io
```

### 10. Configure Dependabot
```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
    open-pull-requests-limit: 10
    labels: ["dependencies", "npm"]
    commit-message:
      prefix: "chore(deps)"
```

### 11. Add Image Optimization
```bash
# Install imagemin for build-time optimization
npm install -D vite-plugin-imagemin imagemin-mozjpeg imagemin-pngquant imagemin-svgo imagemin-webp

# Add to vite.config.js plugins
import imagemin from 'vite-plugin-imagemin'
plugins: [imagemin({
  gzip: true,
  webp: true,
  jpeg: { quality: 80 },
  png: { quality: 80 },
})]
```

---

## 🟢 P3 - LOW (Nice to Have)

### 12. Add Cloudflare Worker for HTTP Headers
GitHub Pages doesn't support custom HTTP headers. Use Cloudflare Workers:

```javascript
// cloudflare-worker.js
export default {
  async fetch(request, env, ctx) {
    const response = await fetch(request);
    const newHeaders = new Headers(response.headers);
    
    // Security headers
    newHeaders.set('X-Content-Type-Options', 'nosniff');
    newHeaders.set('X-Frame-Options', 'DENY');
    newHeaders.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    newHeaders.set('Permissions-Policy', 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()');
    
    // HSTS (only on HTTPS)
    if (request.url.startsWith('https://')) {
      newHeaders.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }
    
    // Cache control for static assets
    const url = new URL(request.url);
    if (url.pathname.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2)$/)) {
      newHeaders.set('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (url.pathname === '/' || url.pathname.endsWith('.html')) {
      newHeaders.set('Cache-Control', 'public, max-age=0, must-revalidate');
    }
    
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  },
};
```

### 13. Add Bundle Analyzer
```bash
npm install -D rollup-plugin-visualizer
# Add to vite.config.js
import { visualizer } from 'rollup-plugin-visualizer'
plugins: [visualizer({ open: true, filename: 'bundle-analysis.html' })]
```

### 14. Set Up Staging Environment
```bash
# Create GitHub Pages staging deployment
# 1. Create gh-pages-staging branch
# 2. Add deploy-staging.yml workflow
# 3. Configure separate Supabase project for staging
```

---

## 📦 Files Created/Modified Summary

| File | Purpose |
|------|---------|
| `.github/workflows/ci.yml` | Enhanced CI with matrix testing, security scanning, bundle size, Lighthouse, Playwright E2E, CodeQL |
| `.github/workflows/deploy.yml` | Enhanced deploy with post-deployment verification |
| `.github/dependency-review-config.yml` | Dependency review rules |
| `public/404.html` | SPA fallback for GitHub Pages |
| `vite.config.js` | Build timestamp, 404 copy, SW version injection |
| `index.html` | CSP, security headers via meta tags |
| `SECRETS_MANAGEMENT.md` | Secrets documentation and rotation strategy |
| `supabase-production-config.sql` | Production Supabase config (RLS, CORS, Realtime, backups) |
| `src/monitoring/sentry.ts` | Sentry error tracking + Web Vitals |
| `src/main.ts` | Monitoring integration |

---

## 🚀 Quick Start Commands

```bash
# 1. Install dependencies
npm ci

# 2. Run full CI locally (simulate)
npm run typecheck && npm run test && npm run build

# 3. Check bundle size
npx vite-bundle-analyzer dist

# 4. Run Lighthouse locally
npx lighthouse http://localhost:8080 --view

# 5. Test production build
npm run preview

# 6. Deploy (push to main triggers auto-deploy)
git push origin main
```

---

## 📊 Success Criteria

| Metric | Target |
|--------|--------|
| CI pass rate | 100% on main |
| Bundle size (JS gzipped) | < 200 KB |
| Lighthouse Performance | ≥ 90 |
| Lighthouse Accessibility | ≥ 90 |
| Lighthouse Best Practices | ≥ 90 |
| Lighthouse SEO | ≥ 80 |
| FCP | < 1.8s |
| LCP | < 2.5s |
| CLS | < 0.1 |
| INP | < 200ms |
| Zero high/critical vulnerabilities | ✅ |
| Zero exposed secrets in repo | ✅ |
| RLS: anon only SELECT | ✅ |
| PITR enabled | ✅ (Pro plan) |
| Sentry error tracking | ✅ |
| Uptime monitoring | ✅ |

---

## 🔄 Ongoing Maintenance

| Task | Frequency |
|------|-----------|
| Rotate secrets | Every 90 days |
| Update dependencies | Weekly (Dependabot) |
| Review security advisories | Weekly |
| Check Lighthouse scores | Per PR |
| Review Sentry errors | Daily |
| Verify backups | Monthly |
| Load test | Quarterly |

---

## 📞 Emergency Contacts

| Issue | Contact |
|-------|---------|
| Supabase down | Supabase Status Page + Support |
| GitHub Pages down | GitHub Status Page |
| Security breach | Rotate all secrets immediately |
| Data loss | Supabase PITR restore |

---

*Generated by DevOps setup session. Review and customize for your specific environment.*