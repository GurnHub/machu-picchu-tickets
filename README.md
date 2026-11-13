# Machu Picchu ticket monitor

Watches https://tuboleto.cultura.pe/llaqta_machupicchu and alerts when tickets for
**1–7 January 2027** go on sale, on any of the 10 routes.

## How it works

A GitHub Actions workflow (`.github/workflows/monitor.yml`) runs
`scripts/monitor.mjs`, which checks every 5 minutes. Each check opens the public
page in headless Chrome, selects each circuit and route, pages the calendar to the
watched dates and reads which days can be picked. One check takes about 40 seconds.

GitHub starts scheduled workflows much less often than their cron asks for (about
hourly in practice), so the 5-minute cadence is kept inside the run: a scheduled
run loops for about 3 hours, and the next scheduled run waits in the queue and
takes over when it ends.

## Alerts

- **Tickets on sale:** an issue labelled `ticket-alert` is opened, mentioning the
  repository owner, so GitHub sends an email and a mobile notification. If more
  dates open later, a comment is added. Nothing is sent again while the issue is
  unchanged; close the issue to re-arm.
- **Monitor broken:** after three failed checks in a row, an issue labelled
  `monitor-broken` is opened. It closes itself when checks pass again.
- **Phone push (optional):** install the [ntfy](https://ntfy.sh) app, subscribe to
  a hard-to-guess topic name, and add that name as the repository secret
  `NTFY_TOPIC`. Alerts are then also pushed at urgent priority.

## Changing things

| What | Where |
|---|---|
| Dates watched | `FROM` / `TO` defaults at the top of `scripts/monitor.mjs` |
| How often | `CHECK_EVERY_SECONDS` (default 300) and `LOOP_MINUTES` in `.github/workflows/monitor.yml` |
| Test the alert | Actions → monitor → Run workflow, with a date range that is on sale and label `test-alert` |

### Notes

The repository is public, so Actions minutes are free. GitHub disables scheduled
workflows in public repositories after 60 days without repository activity;
re-enable it under Actions if that happens. A pushed change takes effect when the
next scheduled run starts, which can be up to 3 hours later.

After 7 January 2027 the script exits without checking; disable the workflow then.
