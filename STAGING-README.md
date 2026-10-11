# Staging copy of wayneconrad.com (homepage redesign)

Upload this folder to a NEW GitHub repo, then in Netlify: Add new site > Import from Git > pick the repo. Build command: none needed (set in netlify.toml). Publish directory: `.`

Differences from live (staging only, do not copy back):
- netlify.toml: IndexNow build step removed; X-Robots-Tag noindex header added.
- robots.txt: disallow all.
- notify-indexnow.js removed.

When approved, copy only `index.html`, `assets/` and other design changes into the live repo, NOT netlify.toml or robots.txt.

Expect on the test site: highlighted {{placeholders}}, a dead worksheet form, and functions (diagnostic, resource downloads) failing unless you add env vars ANTHROPIC_API_KEY, RESEND_API_KEY, RESOURCE_TOKEN_SECRET in Netlify site settings.
