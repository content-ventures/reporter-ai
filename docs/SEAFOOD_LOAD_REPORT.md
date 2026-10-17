# Seafood Show: real-provider load rehearsal

Date: 2026-10-16. Status: local verification only; no deployment.

## Decision

The optimizations substantially reduce the wait before editing article text and remove half the carousel rendering work. The local application passed a short 20-editor workload. This does **not** establish the hosted production ceiling or certify a full event day.

For a reference scenario of **three continuous plenaries transcribed inside Reporter IA**, the observed Groq quota is a release blocker for a reliable real-time operation: 7,200 audio seconds per hour allow approximately two audio hours per wall-clock hour, shared by callers using this quota. Three rooms continuously produce 10,800 seconds per hour before overlap/retries. The resulting queue grows over time. Increasing editor count does not increase provider capacity.

## Measured before/after

Timings include each article request's queue. Both arms use the same three real-material cases, one worker isolate and the active production pipeline configuration. These are observed local timings with live provider requests, not an SLA.

| Measurement | Released V0.5 | Optimized | Observed change |
| --- | ---: | ---: | ---: |
| First article editable | 68.7 s | 34.3 s | +50.0% less time |
| All three articles editable | 239.5 s | 138.2 s | +42.3% less time |
| All three articles with nine images | 239.5 s | 250.6 s | 4.6% longer |
| Export preparation, median of 15 runs | 114.5 ms | 54.6 ms | +52.3% less time |
| Ten simultaneous export preparations, batch | 507.4 ms | 220.3 ms | +56.6% less time |

The full image batch took slightly longer in this run. Image inference was not accelerated; the text no longer waits for it. Under the single-worker queue, the first article's images arrived at 174.9 seconds instead of 68.7 seconds, while all three texts became available earlier. A continuous backlog of higher-priority transcription/text tasks can delay optional images further.

Each generated carousel contained three slides. Export preparation performed **six renders before and three after**. All nine PNG outputs across the three fixed input records had identical SHA-256 hashes between arms, at **1080 × 1350**. Manifests were identical. No failed export file, missing cover or approximate text-overflow warning was observed. Fonts and real generated JPEG assets were preloaded equally in both arms; these timings exclude image download and page startup. The small absolute export time on this machine should not be confused with the much larger AI-generation wait.

## Concurrent editor workload

| Arm | All HTTP requests | Failed requests | 20-editor phase requests | 20-editor p95 read | 20-editor p95 write |
| --- | ---: | ---: | ---: | ---: | ---: |
| V0.5 | 5,289 | 0 | 4,670 | 68.1 ms | 133.5 ms |
| Optimized | 5,569 | 0 | 4,923 | 60.2 ms | 98.6 ms |

Across both arms: **10,858 HTTP requests, zero failures**. All six articles completed on their first attempt, passed the application's R1 article contract and retained three generated images each. All six carousel jobs and their isolated approval flows completed. The optimized background image tasks completed on their first attempt. Each arm made 31 real text calls and nine real image calls; all returned HTTP 200. Image assets remained 1536 × 1024 with the existing `quality: medium` generation setting and JPEG quality 88. This verifies preserved contracts/settings and deterministic export bytes; it is not an independent human evaluation of editorial accuracy.

## Additional complete long-recording check

After recovering the full 65m45s retail recording, a fresh optimized arm generated its article, three images and carousel from the **entire** 61,891-character transcript under the same 10-to-20-editor load. This supplemental run is separate from the frozen before/after comparison.

- Article editable: **89.8 seconds** after enqueue.
- Article with all three images: **129.5 seconds** after enqueue.
- Carousel generation after test approval: **7.9 seconds**.
- Application traffic: **2,617 requests, zero failures**; 2,022 requests in the 20-editor phase. Read/write p95: **45.4 / 66.8 ms**.
- Article: 551 words, no R1 contract issue; article and carousel completed on their first attempt, as did the image task. All 20 real provider calls returned HTTP 200.
- The final three-slide carousel exported successfully through both flows. PNG hashes and manifests matched, with no missing cover or approximate overflow warning.

Across the comparison and supplemental arms: **13,475 application requests, zero application failures**. These are separate from the Groq transcription requests that returned HTTP 429. All three original complete recordings ultimately produced article, images and carousel; the excerpt remained an additional comparison case.

## Real audio and the provider ceiling

Three complete original recordings were exercised simultaneously: **139.6 minutes and 2.35 GB in total**.

| Recording | Duration | Initial processing result |
| --- | ---: | --- |
| Industry / processing automation | 30m22s | Complete in 11.6 s |
| Production / health and biosecurity | 43m27s | Complete in 19.0 s |
| Retail / species mix | 65m45s | Rate-limited; incomplete after the bounded first probe |

The first probe made 17 requests: 14 succeeded and three returned HTTP 429. Groq response headers reported `x-ratelimit-limit-audio-seconds: 7200`, with `Retry-After` values of 112, 296 and 67 seconds. The probe stopped after three attempts; its retry wait was capped at 120 seconds, so it is not a measurement of the application's native defer scheduler or a terminal application failure.

A separate recovery respected the advertised wait, reused the five completed chunks and requested only the two missing chunks. It made three requests, including one HTTP 429 with `Retry-After: 203`; it then completed with **61,891 characters and 1,467 timed segments**. The recovery pass took 211.3 seconds after its media inspection/checksum work. Total rehearsal wall time for the third recording was about 12m16s, including an orchestration gap between probes; this is not a clean end-to-end latency estimate. All three recordings ultimately completed, but the quota demonstrably delayed delivery.

The transcription path was unchanged by the performance patch. The 11.6/19.0-second results demonstrate this machine plus the live Groq service; they do not measure an optimization gain, the upload of these large MP4 files or hosted media processing. [Groq's official rate-limit documentation](https://console.groq.com/docs/rate-limits) defines audio seconds per hour/day, account-specific limits and HTTP 429 behavior. The numeric quota here comes from the actual responses, rather than an assumed plan.

## Operational actions before the event

1. Raise the observed Groq project's hourly audio allowance and verify its daily allowance. For the reference three-room scenario, 10,800 seconds/hour is the mathematical minimum; plan at least 16,200 seconds/hour for a 50% margin, then account for other workloads. This is a planning target, not a measured purchased entitlement. No plan or billing settings were changed.
2. If the event supplies ready transcripts, the Groq audio quota is bypassed for that workflow. Prefer audio or ready transcripts over large video uploads when operationally possible, and rehearse that exact input path.
3. Validate upload bandwidth, real authentication, hosted routing/cold starts, worker concurrency, Neon capacity and a sustained peak in an isolated hosted environment before certifying production. None of those capacities can be inferred from this localhost rehearsal.
4. Keep text delivery independent from optional images in the event runbook. Monitor queue age and rate-limit deferrals; an open screen remaining responsive does not mean the generation queue is keeping pace with plenaries.

## Method and limits

This is a local, isolated load rehearsal with real AI providers, not a production capacity certification. No deployment, production database write, production storage write, billing-plan change, release or remote Git action was performed.

The released v0.5.0 source at commit 265b642b5dd662f42b8f2b852209e451f64c7850 was extracted as the baseline. The optimized arm uses the existing uncommitted implementation, with no runtime edits during measurement. Both arms load pipeline revision 1, hash 5c6ac3d9ad176ee9, confirmed against the authenticated production configuration UI: sequential article generation, evidence curation enabled, OpenAI gpt-6-astra for text; Groq whisper-large-v3 for audio; the existing OpenAI gpt-image-1 image settings. There was no vendor or model migration.

Audio: three original public Podcast Seafood Brasil MP4 recordings, 30m22s / 425,917,439 bytes, 43m27s / 671,083,529 bytes, and 65m45s / 1,254,772,880 bytes. SHA-256 checksums were computed from all original bytes. The actual application inspection, FLAC preparation, transcription and chunk-resume functions ran concurrently against Groq. Only the local source resolver replaced cloud source access. Processing times exclude the original upload, initial checksum pass, cloud bandwidth and hosted CPU performance.

Generation: two complete real transcripts plus a real first-15-minute excerpt from the first recording, 26,278 / 42,178 / 13,398 prose characters before SRT metadata. The excerpt was selected after the third recording was rate-limited; it is not a third complete plenary transcript. It is the same input in both generation arms. The later successful recovery of the full third recording does not change the frozen comparison cases.

Each arm starts a fresh disposable PostgreSQL 17.9 database through the application's real migration/grant tooling, plus local object storage. The application's HTTP workspace handler, RPC commands, production engine, transactions, roles, SQL claims/leases and worker functions run unchanged. Provider requests are real and restricted to the configured official endpoints. Twenty independent editor identities create separate notes, poll once per second and save once per five iterations; the first 45 seconds run ten identities and the rest run twenty. An additional approver identity exercises the isolated review/decision flow. External Neon Auth login is replaced by an identity hook; SQL subject binding and role checks remain real. All identities share one portal, as the event operators would.

Three article requests are enqueued together into one worker isolate. A single worker is a controlled comparison, not a claim about the number of hosted isolates. Baseline processing order was case 0, excerpt, case 1; optimized enqueue order preserves that processing order. Article timing starts at its enqueue request and ends at persisted run completion; it includes queueing. Image timing ends at the persisted images step completion. Carousel timings include their own three-request queue after test approvals. Contract review flags and approvals in the test database are harness actions, not human editorial endorsement.

Browser export runs the real export/render adapters, production template catalogue, bundled Inter font files and generated JPEG assets in headless Chromium. Both arms receive exactly the same approved generated records and image bytes. The baseline follows the previous delivery preparation flow, including rebuilding through manifest creation; the optimized flow passes prepared files to manifest creation. Five alternated passes over three records give 15 measurements per arm. A separate ten-page simultaneous export burst measures client work on one shared load-generator machine, not server-side exports or ten separate operator laptops.

API percentiles cover the local HTTP handler and real database work. They exclude Next.js routing, TLS, Internet latency, external authentication, cloud storage throughput, cold starts, Neon compute/transfer limits and the hosted function platform. This short test does not establish the maximum user count, a full event-day soak result or a production SLA. Three live generation cases are not a statistical estimate of provider latency; reported differences are observed and will vary. Local application caches were isolated per arm; provider-side cache/scheduling variation cannot be excluded.

## Artifacts and reproducibility

Baseline commit: `265b642b5dd662f42b8f2b852209e451f64c7850`. Optimized runtime patch fingerprint: `2eb4bc52c43e1290d613203a6ff2072c92a8cefe1954e73cc70b6457f2b276f1`. Node.js 24.14.0. Provider model, prompt, image-size and quality settings were preserved. Application runtime files were not edited during this rehearsal.

Private scripts, complete source checksums, raw transcripts, provider headers, generated records, image files, export hashes and per-request measurements are under `/private/tmp/reporter-live-load/`. Only this aggregate report belongs in the repository; raw source material, credentials and connection strings are not included. The disposable PostgreSQL databases and object-storage servers are shut down after each arm.
