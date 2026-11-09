import * as Cloudflare from "@alchemy.run/cloudflare"
import * as Alchemy from "alchemy"
import { Effect } from "effect"

export default Alchemy.Stack(
  "effect-miami-slides",
  { state: Cloudflare.state(), providers: Cloudflare.providers() },
  Effect.gen(function* () {
    const site = yield* Cloudflare.Website.StaticSite("Slides", {
      // Slidev also emits a Netlify-style _redirects (/* → /index.html), which Cloudflare
      // rejects as a loop. The SPA fallback below does the same job, so drop it.
      command: "pnpm build:deploy",
      outdir: "dist",
      // Slidev links each slide by path (/12), so unknown paths must boot the app.
      assets: { notFoundHandling: "single-page-application" },
    })
    return { url: site.url }
  }),
)
