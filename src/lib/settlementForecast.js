/**
 * settlementForecast.js
 *
 * Projects when paid-but-unsettled fast withdrawals will settle back to the
 * liquidity provider that fronted them, so the /fast page can chart how much
 * LP liquidity frees up over the coming days.
 *
 * Model: settle time = L2 withdrawal time + the withdrawal->settle delay the
 * same LP has actually seen on its recent completed withdrawals (p10 / p50 /
 * p90). The delay is the challenge window plus outbox-execution batching and
 * is very stable (~14.1-14.7d), so the empirical quantiles are a good
 * predictor. LPs with too few recent settlements fall back to the global
 * quantiles.
 *
 * Consumes the `records` produced by reconcileFastWithdrawals(). Pure,
 * CommonJS, JSON-serializable output (safe for getStaticProps).
 */

'use strict';

const DAY_SEC = 86400;
const DEFAULT_HORIZON_DAYS = 15;
// Only recent settlements inform the delay, so a change to the challenge
// window or executor cadence shows up quickly.
const DEFAULT_SAMPLE_DAYS = 120;
const MIN_LP_SAMPLES = 20;

const OPEN_STATUSES = new Set(['paid_awaiting_settlement', 'payout_overdue_unsettled']);

function quantiles(sorted) {
  const n = sorted.length;
  if (!n) return null;
  const q = (p) => sorted[Math.min(n - 1, Math.floor(p * n))];
  return {
    n,
    min: sorted[0],
    p10: q(0.1),
    p50: q(0.5),
    p90: q(0.9),
    max: sorted[n - 1],
  };
}

function withdrawalSec(r) {
  if (r.l2 && Number.isFinite(r.l2.timestamp)) return r.l2.timestamp;
  const ms = r.payout ? Date.parse(r.payout.timestamp) : NaN;
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/**
 * @param {Array} records  reconcileFastWithdrawals().records
 * @param {Object} [options]
 * @param {string} [options.asOf]  ISO reference time (use summary.as_of)
 * @param {number} [options.horizonDays=15]
 * @param {number} [options.sampleDays=120]
 * @returns {{asOf: number, horizonDays: number, globalDelay: Object|null,
 *   lps: Array<{lp: string, delay: Object, delaySource: string, count: number,
 *   totalMutez: number, feeMutez: number, overdueCount: number}>,
 *   rows: Array<[number, number, number]>}}
 *   rows are [withdrawalSec, fullAmountMutez, lpIndex]
 */
function forecastSettlements(records, options = {}) {
  const asOfMs = options.asOf ? Date.parse(options.asOf) : Date.now();
  const asOf = Math.floor(asOfMs / 1000);
  const horizonDays = options.horizonDays || DEFAULT_HORIZON_DAYS;
  const sampleFrom = asOf - (options.sampleDays || DEFAULT_SAMPLE_DAYS) * DAY_SEC;

  const delaysByLp = new Map();
  const allDelays = [];
  const openByLp = new Map();

  for (const r of records) {
    if (!r.payout || !r.payout.service_provider) continue;
    const lp = r.payout.service_provider;
    const wts = withdrawalSec(r);
    if (wts === null) continue;

    if (r.status === 'completed' && r.settle) {
      const sts = Date.parse(r.settle.timestamp) / 1000;
      if (!Number.isFinite(sts) || sts < sampleFrom) continue;
      const d = sts - wts;
      if (d <= 0) continue;
      allDelays.push(d);
      if (!delaysByLp.has(lp)) delaysByLp.set(lp, []);
      delaysByLp.get(lp).push(d);
    } else if (OPEN_STATUSES.has(r.status)) {
      if (!openByLp.has(lp)) openByLp.set(lp, []);
      openByLp.get(lp).push(r);
    }
  }

  allDelays.sort((a, b) => a - b);
  const globalDelay = quantiles(allDelays);

  const lps = [];
  const rows = [];
  const lpOrder = [...openByLp.entries()].sort(
    (a, b) =>
      b[1].reduce((s, r) => s + Number(r.payout.full_amount_mutez), 0) -
      a[1].reduce((s, r) => s + Number(r.payout.full_amount_mutez), 0)
  );
  for (const [lp, open] of lpOrder) {
    const own = (delaysByLp.get(lp) || []).sort((a, b) => a - b);
    const useOwn = own.length >= MIN_LP_SAMPLES || !globalDelay;
    const delay = useOwn ? quantiles(own) : globalDelay;
    if (!delay) continue;
    const idx = lps.length;
    let totalMutez = 0;
    let feeMutez = 0;
    let overdueCount = 0;
    for (const r of open) {
      const full = Number(r.payout.full_amount_mutez);
      totalMutez += full;
      feeMutez += Number(r.payout.fee_mutez || 0);
      if (r.status === 'payout_overdue_unsettled') overdueCount++;
      rows.push([withdrawalSec(r), full, idx]);
    }
    lps.push({
      lp,
      delay,
      delaySource: useOwn ? 'lp' : 'global',
      count: open.length,
      totalMutez,
      feeMutez,
      overdueCount,
    });
  }
  rows.sort((a, b) => a[0] - b[0]);

  return { asOf, horizonDays, globalDelay, lps, rows };
}

module.exports = { forecastSettlements };
