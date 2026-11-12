# Machu Picchu ticket monitor

Watches https://tuboleto.cultura.pe/llaqta_machupicchu and alerts when tickets for
**1–7 January 2027** go on sale, on any of the 10 routes.

## How it works

A GitHub Actions workflow (`.github/workflows/monitor.yml`) runs
`scripts/monitor.mjs` every 30 minutes. The script opens the public page in
headless Chrome, selects each circuit and route, pages the calendar to the watched
dates and reads which days can be picked. One run takes about 45 seconds.

## Alerts

- **Tickets on sale:** an issue labelled `ticket-alert` is opened, mentioning the
  repository owner, so GitHub sends an email and a mobile notification. If more
  dates open later, a comment is added. Nothing is sent again while the issue is
  unchanged; close the issue to re-arm.
- **Monitor broken:** after three failed scheduled runs in a row, an issue labelled
  `monitor-broken` is opened. It closes itself when checks pass again.
- **Phone push (optional):** install the [ntfy](https://ntfy.sh) app, subscribe to
  a hard-to-guess topic name, and add that name as the repository secret
  `NTFY_TOPIC`. Alerts are then also pushed at urgent priority.

## Changing things

| What | Where |
|---|---|
| Dates watched | `FROM` / `TO` defaults at the top of `scripts/monitor.mjs` |
| How often | `cron` in `.github/workflows/monitor.yml` |
| Test the alert | Actions → monitor → Run workflow, with a date range that is on sale and label `test-alert` |

### Frequency and Actions minutes

Each run is billed as one minute. On a private repository the free plan includes
2,000 minutes a month, and every 30 minutes uses about 1,490. If the quota runs out
the checks stop silently. On a public repository Actions is free, and the cron can
be tightened to `*/5 * * * *` (GitHub's minimum; scheduled runs can start several
minutes late).

After 7 January 2027 the script exits without checking; disable the workflow then.
