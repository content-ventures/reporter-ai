# News intake (F2.1, REQ-2.1)

The desk's sources and the news they bring live on the server. A feed or a pasted link becomes one
normalized news item; a repeat is dropped, and the same story from another outlet joins the first
item as a duplicate without erasing its origin.

## Sources

| Kind | How it is made | Read as |
| --- | --- | --- |
| `rss` | An outlet's feed, or its site: the page's `<link rel="alternate">` is followed | RSS 2.0, RSS 1.0, Atom or JSON Feed |
| `google-alerts` | One Google Alertas feed per keyword, pasted in Integrações › Google Alertas (or in Fontes) | Atom; Google's redirect links are unwrapped to the outlet's address |
| `rss-app` | RSS.app makes the feed of a site without one, or of a keyword (`POST /v1/feeds`) | Plain RSS (`rss_feed_url`), so reading needs no key |

Any feed RSS.app already made can also be added as a plain `rss` source by its address.

The desk adds sources in **Fontes** (`/news/sources`, "Feed ou site", "Site sem feed", "Palavra-chave")
and in **Integrações** (Google Alertas and RSS.app pages). The first read happens while the source is
added, so it arrives with its news. Removing a source keeps its news and deletes its RSS.app feed.

## Start with a portal or sector

The empty radar and Fontes offer **Descobrir fontes**. Enter a portal URL, a sector, or both, with
an optional region. The portal is the client publication that will create articles, not an intake
source. The server reads its public metadata only as context and uses the existing Tavily search
integration to find external publishers. The entered and redirected client domains, including their
subdomains, are excluded from candidates, feed identities and sample article links. Every selectable suggestion has a feed that was actually
fetched and parsed, a search reference, a reason and recent sample headlines. Inaccessible sites and
sites without a verified feed remain visible with their limitation; they cannot be subscribed to.

Choose the external sources, then add them. Discovery itself writes nothing. Each selected source
is saved and read immediately, with its own result and number of newly imported stories. A source
whose first collection fails stays registered and can be retried without a duplicate subscription.
A valid feed with no recent stories says so; it never receives invented sample news. Existing feeds
are marked as registered. RSS and URL import work without any external API key; discovery requires
`TAVILY_API_KEY`. RSS.app is optional and is only needed to create feeds for unsupported sites.

## Normalization and dedupe

`src/domain/news-intake.ts` (pure, tested) turns every entry into one shape: title, link, canonical
link, outlet, publication date, lead and paragraphs (at most 20,000 characters), image and a story key.

- **Identity**: the feed's own id (guid, Atom id, JSON Feed id) inside its source.
- **Link**: the canonical address (https, no `www.`, no tracking parameters, no fragment, sorted
  query, no trailing slash). PostgreSQL keeps one item per canonical link per portal.
- **Same story, another outlet**: headlines with at least four significant words share a story key
  (folded words, sorted). Within 72 hours, an entry from another outlet with the same key joins the
  first item's `duplicates` ("Quem publicou").
- **Pasted link**: checked against the queue first (a link already there opens its story, even when
  the site refuses automatic reading), then read in this order: JSON-LD `NewsArticle`, OpenGraph and
  the page's tags, the paragraphs of its `<article>`. The page's canonical stands for it only on the
  same site.

## Reading

- `src/server/news-fetch.ts`: public http(s) on ports 80/443 only, every redirect re-checked (at most
  five), 15-second budget, byte cap, the source's ETag and Last-Modified, charset from the header or
  the document (ISO-8859-1 sites included).
- The worker (`runNewsSource`, in the drain and in the local loop) reads one due source per job under
  a two-minute lease. `reporter_worker_pending()` now also wakes for due sources.
- The hourly safety sweep reads what is due, at most an hour late. While someone has the radar,
  Fontes or Integrações open, the page polls every minute and the poll wakes the worker when a source
  is due (at most once a minute per server instance), so the 15- and 30-minute frequencies hold while
  the desk is watching and nothing runs while nobody is.
- A failed read keeps only a code; a failed first collection or three later failures in a row show
  the source as "Com falha" with the reason.
  The next try waits for the source's own interval.

## Limits (pending decision: feeds, frequency and limits)

| Limit | Value |
| --- | --- |
| Sources per workspace | 30 |
| Entries kept per read | 50, newest first |
| A source's first read | the last 7 days |
| Feed / page size | 2 MB / 3 MB |
| Read timeout | 15 s |
| Frequencies | 15, 30, 60 (default), 120, 360 minutes |
| Radar window | the last 7 days plus retained selections and postponements, 400 items per poll |

They are constants in `NEWS_LIMITS` (domain) and the migration.

## Database

`database/migrations/024-news-intake.sql`: `public.reporter_news_sources` and
`public.reporter_news_items`, reachable only through security-definer functions. Reads need
`reporter.read`; every write needs `reporter.edit` and lands in the audit log. The radar's poll
(`reporter_news_view(since)`) returns the current source list and changed items; items travel without
their text, which the open story reads once (`reporter_news_item`). A direct item link also works
outside the initial radar window. A poll drains all 400-item pages using a fixed upper bound and
the exact timestamp/id cursor before advancing its checkpoint. Failed pages retry the same
window, so larger initial collections and older selections are not skipped.
Tests: `database/tests/news-intake.integration.sql`.

`025-news-decisions.sql` adds durable select, postpone, discard and restore actions. Every action
checks `reporter.edit`, the portal and the decision revision before writing its actor, time and audit
entry. Conflicting decisions return HTTP 409. Due postponements return once during a server read,
with a system audit event; selected stories stay available beyond the import window. Tests:
`database/tests/news-decisions.integration.sql` and `tests/news-decisions.test.ts`.

## Screens

In the connected build the radar, Fontes and the Google Alertas and RSS.app pages read the server
and carry no "Demo". The radar shows arrivals, grouped coverage and source health. The story's
decision bar offers **Selecionar para redação**, **Adiar** and **Descartar**, with restore available
under Decididas. Selection keeps the article's source material ready for the writing workflow;
it does not create a production or generate a Hard News article. The AI's editorial classification
(F2.4) is still outside this delivery. The fixtures build keeps the simulated desk.

Source suggestions, source lists and the radar display publisher favicons through the public
Design System `BrandMark`, using the same image service as the integration catalogue. Only the
publisher hostname is sent to that service; article paths and query parameters are not. Failed
images use the Design System fallback.

Feed text can be only a summary. The story labels it as **Texto recebido do feed**; manually
imported pages use **Texto extraído da página**. The original link and publication attribution
remain available in either case. Body-loading failures expose a retry without hiding the lead.

## RSS.app account

Creating and deleting feeds use the platform's account, configured in the Vercel app (Production
and Preview): `RSS_APP_API_KEY` and `RSS_APP_API_SECRET` (sent as `Bearer key:secret`). Optional:
`RSS_APP_REGION` for keyword feeds (default `BR:pt-419`; RSS.app documents only `US:en`, so confirm
it with the account). Without the key, "Site sem feed" and "Palavra-chave" say RSS.app is not
connected and the RSS.app page shows how to connect it. The worker needs no RSS.app setting.
