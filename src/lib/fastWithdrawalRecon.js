/**
 * fastWithdrawalRecon.js
 *
 * Reconciliation core for Etherlink fast withdrawals.
 *
 * Joins the three legs of a fast withdrawal's lifecycle on `withdrawal_id`
 * (the global outbox counter):
 *   1. L2 FastWithdrawal event  (etherlinkFastLogsCache.json -> .data)
 *   2. L1 payout_withdrawal     (tzktFastEventsCache.json    -> .data)
 *   3. L1 settle_withdrawal     (tzktFastEventsCache.json    -> .data)
 *
 * and produces exactly one record per distinct withdrawal_id, each with a
 * single `status`, plus a global summary, a per-liquidity-provider summary
 * and a flat anomaly list.
 *
 * Pure data-in/data-out CommonJS module: no fs, no network, no top-level
 * await — safe to import from Next.js getStaticProps. All output is
 * JSON-serializable.
 *
 * Units:
 *   - L2 `amount` is wei (1e18 wei = 1 XTZ)
 *   - L1 `full_amount` / `payout_amount` are mutez strings (1e6 = 1 XTZ)
 *   - 1 wei-XTZ = 1e12 * mutez, i.e. amounts match when wei === mutez * 1e12
 */

'use strict';

const MUTEZ_PER_XTZ = 1e6;
const WEI_PER_XTZ = 1e18;
const WEI_PER_MUTEZ = 1000000000000n; // 1e12

/**
 * Challenge-window threshold (days) after which a paid-but-unsettled
 * withdrawal is considered overdue, and an unpaid/unsettled L2 withdrawal
 * is considered stale.
 *
 * Derivation from the real caches (2026-07-24): payout->settle delay over
 * 27,057 settled pairs is min 13.1d / p50 14.1d / p99 18.5d / max 24.8d.
 * The max is a single outlier (withdrawal 20708, payout 2026-01-26); the
 * next-largest cluster tops out at 19.7d. Threshold = p99 (18.5) + ~2.5d
 * margin = 21 days. The one historical 24.8d settlement would have been
 * transiently flagged overdue — acceptable for a monitoring view.
 */
const DEFAULT_OVERDUE_DAYS = 21;

/**
 * First event on the production L1 fast-withdrawal contract
 * (KT1BGwyCrnJ6HuEYP7X8Q2UooTdxmEYHiK6j). L2-only events strictly before
 * this are pre-production experiments (ids ~473-561, March/April 2025,
 * believed to target a never-deployed placeholder contract) and are
 * classified `pre_production` rather than as scary anomalies.
 * Recomputed from the data when L1 events are present; this constant is
 * only the fallback.
 */
const DEFAULT_PRODUCTION_START_MS = Date.parse('2025-04-17T09:50:04Z');

const STATUSES = [
  'pending', //                      L2 event only, recent
  'paid_awaiting_settlement', //     payout, no settle, within window
  'completed', //                    payout + settle paid back to the LP
  'settled_direct', //               no payout; settled straight to base_withdrawer (slow path)
  'pre_production', //               L2 event predating the production L1 contract, no L1 legs
  // anomaly statuses:
  'payout_overdue_unsettled', //     payout, no settle, past the window
  'initiated_stale', //              L2 only, past the window (post-production)
  'settled_to_unexpected_receiver', // settle receiver is neither paying LP nor base_withdrawer,
  //                                   or is base_withdrawer despite an LP having paid (LP loss)
  'l1_only', //                      L1 payout/settle with no matching L2 event (data gap / scanner bug)
  'amount_mismatch', //              L2 wei amount != L1 mutez amount * 1e12
];

const ANOMALY_STATUSES = new Set([
  'payout_overdue_unsettled',
  'initiated_stale',
  'settled_to_unexpected_receiver',
  'l1_only',
  'amount_mismatch',
]);

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function toBigIntOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  try {
    return BigInt(v);
  } catch (e) {
    return null;
  }
}

function mutezToXtz(mutez) {
  const b = toBigIntOrNull(mutez);
  if (b === null) return null;
  return Number(b) / MUTEZ_PER_XTZ;
}

function weiToXtz(wei) {
  const b = toBigIntOrNull(wei);
  if (b === null) return null;
  return Number(b) / WEI_PER_XTZ;
}

function round6(x) {
  return x === null || x === undefined ? null : Math.round(x * 1e6) / 1e6;
}

/** Group rows into a Map keyed by withdrawal_id (values are arrays). */
function groupById(rows) {
  const map = new Map();
  for (const row of rows) {
    const id = String(row.withdrawal_id);
    const list = map.get(id);
    if (list) list.push(row);
    else map.set(id, [row]);
  }
  return map;
}

function isoOrNull(ms) {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

// ---------------------------------------------------------------------------
// leg extraction
// ---------------------------------------------------------------------------

function l2Leg(e) {
  const tsSec = Number(e.block_timestamp != null ? e.block_timestamp : e.timestamp);
  return {
    transaction_hash: e.transaction_hash || null,
    block_number: e.block_number != null ? Number(e.block_number) : null,
    timestamp: Number.isFinite(tsSec) ? tsSec : null, // unix seconds
    timestamp_iso: Number.isFinite(tsSec) ? new Date(tsSec * 1000).toISOString() : null,
    amount_wei: e.amount != null ? String(e.amount) : null,
    amount_xtz: round6(weiToXtz(e.amount)),
    l2_caller: e.l2_caller || null,
    target_receiver: e.target_receiver || null,
    // Opaque passthrough. Format varies over history (early events are
    // 32-byte abi-style values, later ones Michelson-packed 0x0500...).
    payload: e.payload || null,
  };
}

function payoutLeg(e) {
  const full = toBigIntOrNull(e.full_amount);
  const paid = toBigIntOrNull(e.payout_amount);
  const fee = full !== null && paid !== null ? full - paid : null;
  return {
    hash: e.hash || null,
    level: e.level != null ? Number(e.level) : null,
    timestamp: e.event_timestamp || null, // ISO string
    full_amount_mutez: e.full_amount != null ? String(e.full_amount) : null,
    payout_amount_mutez: e.payout_amount != null ? String(e.payout_amount) : null,
    fee_mutez: fee !== null ? fee.toString() : null,
    full_amount_xtz: round6(mutezToXtz(e.full_amount)),
    payout_amount_xtz: round6(mutezToXtz(e.payout_amount)),
    fee_xtz: fee !== null ? round6(Number(fee) / MUTEZ_PER_XTZ) : null,
    service_provider: e.service_provider || null,
    base_withdrawer: e.base_withdrawer || null,
    l2_address: e.l2_address || null,
    ticketer: e.ticketer || null,
    // Opaque passthrough of the Michelson-packed payload (encodes the
    // discounted amount the user agreed to).
    payload: e.payload || null,
  };
}

function settleLeg(e) {
  return {
    hash: e.hash || null,
    level: e.level != null ? Number(e.level) : null,
    timestamp: e.event_timestamp || null, // ISO string
    receiver: e.receiver || null,
    full_amount_mutez: e.full_amount != null ? String(e.full_amount) : null,
    full_amount_xtz: round6(mutezToXtz(e.full_amount)),
    base_withdrawer: e.base_withdrawer || null,
    l2_address: e.l2_address || null,
  };
}

// ---------------------------------------------------------------------------
// payload decoding
// ---------------------------------------------------------------------------

/**
 * Decode a Bytes.pack-ed Michelson nat: `05` (pack prefix) + `00` (int tag)
 * + Zarith signed varint. First varint byte: bit7 = continuation, bit6 =
 * sign (must be 0 for a nat), bits 5-0 = lowest 6 value bits; each following
 * byte: bit7 = continuation, bits 6-0 = next 7 value bits (little-endian
 * accumulation).
 *
 * On production fast withdrawals the payload encodes the discounted amount
 * (mutez) the LP should pay. Accepts 0x-prefixed (L2 events) or bare (L1
 * events) hex. Returns the value as a decimal string, or null when the bytes
 * are not a validly packed nat (e.g. the 32-byte abi-style payloads used by
 * pre-production events and by occasional mis-encoded withdrawals).
 *
 * @param {string|null|undefined} payload
 * @returns {string|null} mutez as decimal string, or null
 */
function decodePackedNat(payload) {
  if (payload == null) return null;
  let hex = String(payload).toLowerCase();
  if (hex.startsWith('0x')) hex = hex.slice(2);
  if (hex.length < 6 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/.test(hex)) return null;
  if (!hex.startsWith('0500')) return null;
  let value = 0n;
  let shift = 6n;
  for (let i = 4; i < hex.length; i += 2) {
    const b = parseInt(hex.slice(i, i + 2), 16);
    if (i === 4) {
      if (b & 0x40) return null; // sign bit set -> negative int, not a nat
      value = BigInt(b & 0x3f);
    } else {
      value += BigInt(b & 0x7f) << shift;
      shift += 7n;
    }
    if ((b & 0x80) === 0) return i + 2 === hex.length ? value.toString() : null; // trailing junk
  }
  return null; // ended with the continuation bit still set
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

/**
 * Reconcile fast withdrawals across the L2 and L1 legs.
 *
 * @param {Array|{data:Array}} l2Events  entries of etherlinkFastLogsCache.json
 *   (either the `.data` array or the whole cache object)
 * @param {Array|{data:Array}} l1Events  entries of tzktFastEventsCache.json
 *   (tags payout_withdrawal / settle_withdrawal; array or cache object)
 * @param {Object} [options]
 * @param {number} [options.now]  reference time in ms since epoch used for
 *   age-based statuses. Defaults to the newest event timestamp across both
 *   inputs (deterministic "as of the data" view).
 * @param {number} [options.overdueDays=21]  challenge-window threshold.
 *
 * @returns {{records: Array, summary: Object, lpSummary: Array, anomalies: Array, meta: Object}}
 */
function reconcileFastWithdrawals(l2Events, l1Events, options = {}) {
  const l2Rows = Array.isArray(l2Events) ? l2Events : (l2Events && l2Events.data) || [];
  const l1Rows = Array.isArray(l1Events) ? l1Events : (l1Events && l1Events.data) || [];

  const payoutRows = [];
  const settleRows = [];
  const unknownTagRows = [];
  for (const e of l1Rows) {
    if (e.tag === 'payout_withdrawal') payoutRows.push(e);
    else if (e.tag === 'settle_withdrawal') settleRows.push(e);
    else unknownTagRows.push(e);
  }

  const l2ById = groupById(l2Rows);
  const payoutById = groupById(payoutRows);
  const settleById = groupById(settleRows);

  // Reference clock: newest event seen anywhere (deterministic), unless
  // the caller pins one.
  let maxMs = 0;
  for (const e of l2Rows) {
    const ms = Number(e.block_timestamp != null ? e.block_timestamp : e.timestamp) * 1000;
    if (Number.isFinite(ms) && ms > maxMs) maxMs = ms;
  }
  for (const e of l1Rows) {
    const ms = Date.parse(e.event_timestamp);
    if (Number.isFinite(ms) && ms > maxMs) maxMs = ms;
  }
  const nowMs = Number.isFinite(options.now) ? options.now : maxMs || Date.now();

  const overdueDays = Number.isFinite(options.overdueDays)
    ? options.overdueDays
    : DEFAULT_OVERDUE_DAYS;
  const overdueMs = overdueDays * 86400000;

  // Production start = first L1 event, capped by the known constant so a
  // truncated L1 cache (first rows missing) can never push it later and
  // misclassify genuine post-production withdrawals as pre_production.
  let productionStartMs = DEFAULT_PRODUCTION_START_MS;
  for (const e of l1Rows) {
    const ms = Date.parse(e.event_timestamp);
    if (Number.isFinite(ms) && ms < productionStartMs) productionStartMs = ms;
  }

  const allIds = new Set([...l2ById.keys(), ...payoutById.keys(), ...settleById.keys()]);
  // Sort numerically (withdrawal_id is a global counter).
  const sortedIds = [...allIds].sort((a, b) => Number(a) - Number(b));

  const records = [];
  const anomalies = [];

  const addAnomaly = (type, withdrawalId, detail) => {
    anomalies.push({ type, withdrawal_id: withdrawalId, detail });
  };

  for (const id of sortedIds) {
    const l2All = l2ById.get(id) || [];
    const payoutAll = payoutById.get(id) || [];
    const settleAll = settleById.get(id) || [];

    // withdrawal_id is expected unique per leg (validated true on current
    // caches), but older data has had duplicate artifacts: key on the first
    // (chronologically earliest) row and surface the rest as anomalies
    // instead of silently dropping them.
    const l2Sorted = [...l2All].sort(
      (a, b) => Number(a.block_timestamp || a.timestamp) - Number(b.block_timestamp || b.timestamp)
    );
    const payoutSorted = [...payoutAll].sort(
      (a, b) => Date.parse(a.event_timestamp) - Date.parse(b.event_timestamp)
    );
    const settleSorted = [...settleAll].sort(
      (a, b) => Date.parse(a.event_timestamp) - Date.parse(b.event_timestamp)
    );

    const l2 = l2Sorted.length ? l2Leg(l2Sorted[0]) : null;
    const payout = payoutSorted.length ? payoutLeg(payoutSorted[0]) : null;
    const settle = settleSorted.length ? settleLeg(settleSorted[0]) : null;

    const flags = [];

    if (l2Sorted.length > 1) {
      flags.push('duplicate_l2_events');
      addAnomaly('duplicate_l2_events', id, {
        count: l2Sorted.length,
        transaction_hashes: l2Sorted.map((r) => r.transaction_hash),
      });
    }
    if (payoutSorted.length > 1) {
      flags.push('duplicate_payout_events');
      addAnomaly('duplicate_payout_events', id, {
        count: payoutSorted.length,
        hashes: payoutSorted.map((r) => r.hash),
      });
    }
    if (settleSorted.length > 1) {
      flags.push('duplicate_settle_events');
      addAnomaly('duplicate_settle_events', id, {
        count: settleSorted.length,
        hashes: settleSorted.map((r) => r.hash),
      });
    }

    // -- cross-leg consistency flags (informational; do not drive status) --
    const l1Primary = payout || settle;

    if (l2 && l1Primary && l1Primary.l2_address && l2.l2_caller) {
      if (l2.l2_caller.toLowerCase() !== l1Primary.l2_address.toLowerCase()) {
        flags.push('l2_address_mismatch');
        addAnomaly('l2_address_mismatch', id, {
          l2_caller: l2.l2_caller,
          l1_l2_address: l1Primary.l2_address,
        });
      }
    }
    if (
      payout &&
      settle &&
      payout.full_amount_mutez !== null &&
      settle.full_amount_mutez !== null &&
      payout.full_amount_mutez !== settle.full_amount_mutez
    ) {
      flags.push('payout_settle_amount_mismatch');
      addAnomaly('payout_settle_amount_mismatch', id, {
        payout_full_amount: payout.full_amount_mutez,
        settle_full_amount: settle.full_amount_mutez,
      });
    }
    if (payout && payout.fee_mutez !== null && BigInt(payout.fee_mutez) < 0n) {
      flags.push('negative_fee');
      addAnomaly('negative_fee', id, {
        full_amount: payout.full_amount_mutez,
        payout_amount: payout.payout_amount_mutez,
      });
    }
    if (
      payout &&
      settle &&
      payout.base_withdrawer &&
      settle.base_withdrawer &&
      payout.base_withdrawer !== settle.base_withdrawer
    ) {
      flags.push('base_withdrawer_mismatch');
      addAnomaly('base_withdrawer_mismatch', id, {
        payout_base_withdrawer: payout.base_withdrawer,
        settle_base_withdrawer: settle.base_withdrawer,
      });
    }

    // -- amount check: L2 wei vs L1 mutez (scale factor 1e12, exact) --
    let amountMismatch = false;
    if (l2 && l1Primary && l2.amount_wei !== null && l1Primary.full_amount_mutez !== null) {
      const wei = toBigIntOrNull(l2.amount_wei);
      const mutez = toBigIntOrNull(l1Primary.full_amount_mutez);
      if (wei !== null && mutez !== null && wei !== mutez * WEI_PER_MUTEZ) {
        amountMismatch = true;
      }
    }

    const baseWithdrawer =
      (payout && payout.base_withdrawer) || (settle && settle.base_withdrawer) || null;

    // -- status assignment (exactly one per record) --
    let status;
    const l2AgeMs = l2 && l2.timestamp !== null ? nowMs - l2.timestamp * 1000 : null;
    const payoutAgeMs = payout && payout.timestamp ? nowMs - Date.parse(payout.timestamp) : null;

    if (!l2) {
      // L1 leg(s) with no matching L2 event. Zero cases in current caches;
      // kept for robustness against scanner gaps.
      status = 'l1_only';
    } else if (amountMismatch) {
      status = 'amount_mismatch';
    } else if (settle) {
      if (payout) {
        status =
          settle.receiver === payout.service_provider
            ? 'completed'
            : // covers: receiver == base_withdrawer despite LP payout (LP ate
              // a loss) and receiver == unrelated third party
              'settled_to_unexpected_receiver';
      } else {
        status =
          settle.receiver === baseWithdrawer ? 'settled_direct' : 'settled_to_unexpected_receiver';
      }
    } else if (payout) {
      status =
        payoutAgeMs !== null && payoutAgeMs > overdueMs
          ? 'payout_overdue_unsettled'
          : 'paid_awaiting_settlement';
    } else if (l2.timestamp !== null && l2.timestamp * 1000 < productionStartMs) {
      // Early experiments predating the production L1 contract (possibly
      // targeting the never-deployed placeholder
      // KT1TczPwz5KjAuuJKvkTmttS7bBioT5gjQ4Y). Expected to never resolve.
      status = 'pre_production';
    } else {
      status = l2AgeMs !== null && l2AgeMs > overdueMs ? 'initiated_stale' : 'pending';
    }

    // -- payload cross-check ------------------------------------------------
    // The payload is a packed Michelson nat carrying the discounted amount
    // (mutez) the LP must pay. Decode it (L2 payload preferred; identical to
    // the L1 copy on all joined records) and cross-check:
    //  (a) payout leg present: decoded value must equal payout_amount;
    //  (b) no payout: an undecodable / zero / larger-than-full-amount value
    //      is the mis-encoded-payload failure mode (no LP will pick it up;
    //      the withdrawal falls back to the 14-day slow path) -> flag
    //      `invalid_payload` even after it settles direct, so the cause
    //      stays visible;
    //  (c) a VALID payload with no payout is not an anomaly: it means no LP
    //      has picked it up yet (LP outage / LP choice). While recent it
    //      stays `pending`; persistence is caught by `initiated_stale` or
    //      resolves as `settled_direct` at ~14d.
    // pre_production records use a 32-byte abi-style payload that predates
    // this format and are expected not to decode -> exempt.
    const payloadHex = l2 ? l2.payload : l1Primary ? l1Primary.payload : null;
    const decodedPayload = status === 'pre_production' ? null : decodePackedNat(payloadHex);
    if (status !== 'pre_production' && payloadHex !== null) {
      if (payout && payout.payout_amount_mutez !== null) {
        if (decodedPayload === null || BigInt(decodedPayload) !== BigInt(payout.payout_amount_mutez)) {
          flags.push('payload_payout_mismatch');
          addAnomaly('payload_payout_mismatch', id, {
            payload: payloadHex,
            decoded_mutez: decodedPayload,
            payout_amount_mutez: payout.payout_amount_mutez,
          });
        }
      } else if (!payout) {
        // Plausibility bound: the full withdrawal amount in mutez.
        const wei = l2 ? toBigIntOrNull(l2.amount_wei) : null;
        const fullMutez =
          wei !== null
            ? wei / WEI_PER_MUTEZ
            : l1Primary
              ? toBigIntOrNull(l1Primary.full_amount_mutez)
              : null;
        const invalidReason =
          decodedPayload === null
            ? 'not_a_packed_nat'
            : BigInt(decodedPayload) === 0n
              ? 'zero'
              : fullMutez !== null && BigInt(decodedPayload) > fullMutez
                ? 'exceeds_full_amount'
                : null;
        if (invalidReason) {
          flags.push('invalid_payload');
          addAnomaly('invalid_payload', id, {
            reason: invalidReason,
            payload: payloadHex,
            decoded_mutez: decodedPayload,
            full_amount_mutez: fullMutez !== null ? fullMutez.toString() : null,
          });
        }
      }
    }

    if (ANOMALY_STATUSES.has(status)) {
      addAnomaly(status, id, {
        l2_tx: l2 ? l2.transaction_hash : null,
        payout_hash: payout ? payout.hash : null,
        settle_hash: settle ? settle.hash : null,
        receiver: settle ? settle.receiver : null,
        service_provider: payout ? payout.service_provider : null,
        base_withdrawer: baseWithdrawer,
        amount_wei: l2 ? l2.amount_wei : null,
        full_amount_mutez: l1Primary ? l1Primary.full_amount_mutez : null,
      });
    }

    const payoutToSettleDays =
      payout && settle && payout.timestamp && settle.timestamp
        ? round6((Date.parse(settle.timestamp) - Date.parse(payout.timestamp)) / 86400000)
        : null;

    const record = {
      withdrawal_id: id,
      status,
      flags,
      // canonical display amount: prefer the L2 wei amount, fall back to L1
      amount_xtz:
        (l2 && l2.amount_xtz) !== null && l2
          ? l2.amount_xtz
          : l1Primary
            ? l1Primary.full_amount_xtz
            : null,
      base_withdrawer: baseWithdrawer,
      // discounted amount the LP should pay, decoded from the packed payload
      // (null when non-decodable or pre_production)
      payload_amount_mutez: decodedPayload,
      payload_amount_xtz:
        decodedPayload !== null ? round6(Number(decodedPayload) / MUTEZ_PER_XTZ) : null,
      l2,
      payout,
      settle,
      payout_to_settle_days: payoutToSettleDays,
    };
    if (l2Sorted.length > 1 || payoutSorted.length > 1 || settleSorted.length > 1) {
      record.duplicates = {
        l2: l2Sorted.slice(1).map(l2Leg),
        payout: payoutSorted.slice(1).map(payoutLeg),
        settle: settleSorted.slice(1).map(settleLeg),
      };
    }
    records.push(record);
  }

  // -- reconciliation invariants: every input row in exactly one record ----
  let l2Consumed = 0;
  let payoutConsumed = 0;
  let settleConsumed = 0;
  for (const r of records) {
    l2Consumed += (r.l2 ? 1 : 0) + (r.duplicates ? r.duplicates.l2.length : 0);
    payoutConsumed += (r.payout ? 1 : 0) + (r.duplicates ? r.duplicates.payout.length : 0);
    settleConsumed += (r.settle ? 1 : 0) + (r.duplicates ? r.duplicates.settle.length : 0);
  }
  const reconciliationErrors = [];
  if (l2Consumed !== l2Rows.length)
    reconciliationErrors.push(`l2 rows: consumed ${l2Consumed} of ${l2Rows.length}`);
  if (payoutConsumed !== payoutRows.length)
    reconciliationErrors.push(`payout rows: consumed ${payoutConsumed} of ${payoutRows.length}`);
  if (settleConsumed !== settleRows.length)
    reconciliationErrors.push(`settle rows: consumed ${settleConsumed} of ${settleRows.length}`);
  if (records.length !== allIds.size)
    reconciliationErrors.push(`records ${records.length} != distinct ids ${allIds.size}`);
  if (unknownTagRows.length) {
    reconciliationErrors.push(`${unknownTagRows.length} L1 rows with unknown tag`);
    addAnomaly('unknown_l1_tag', null, {
      count: unknownTagRows.length,
      tags: [...new Set(unknownTagRows.map((r) => r.tag))],
    });
  }
  for (const err of reconciliationErrors) addAnomaly('reconciliation_failure', null, { error: err });

  // -- global summary -------------------------------------------------------
  const statusCounts = {};
  for (const s of STATUSES) statusCounts[s] = 0;
  let totalAmountXtz = 0;
  let totalPaidOutXtz = 0;
  let totalSettledXtz = 0;
  let outstandingExposureXtz = 0;
  for (const r of records) {
    statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
    if (r.amount_xtz) totalAmountXtz += r.amount_xtz;
    if (r.payout && r.payout.payout_amount_xtz) totalPaidOutXtz += r.payout.payout_amount_xtz;
    if (r.settle && r.settle.full_amount_xtz) totalSettledXtz += r.settle.full_amount_xtz;
    if (r.payout && !r.settle && r.payout.payout_amount_xtz)
      outstandingExposureXtz += r.payout.payout_amount_xtz;
  }

  const summary = {
    as_of: isoOrNull(nowMs),
    total_withdrawals: records.length,
    status_counts: statusCounts,
    anomaly_count: anomalies.length,
    totals: {
      l2_events: l2Rows.length,
      payout_events: payoutRows.length,
      settle_events: settleRows.length,
      total_amount_xtz: round6(totalAmountXtz),
      total_paid_out_xtz: round6(totalPaidOutXtz),
      total_settled_xtz: round6(totalSettledXtz),
      outstanding_exposure_xtz: round6(outstandingExposureXtz),
    },
    thresholds: {
      overdue_days: overdueDays,
      production_start: isoOrNull(productionStartMs),
    },
  };

  // -- per-LP summary -------------------------------------------------------
  const lpMap = new Map();
  for (const r of records) {
    if (!r.payout || !r.payout.service_provider) continue;
    const sp = r.payout.service_provider;
    let lp = lpMap.get(sp);
    if (!lp) {
      lp = {
        service_provider: sp,
        payout_count: 0,
        total_paid_out_xtz: 0,
        completed_count: 0,
        realized_fees_xtz: 0,
        awaiting_count: 0,
        unrealized_fees_xtz: 0,
        outstanding_count: 0,
        outstanding_exposure_xtz: 0,
        overdue_count: 0,
        overdue_exposure_xtz: 0,
        anomaly_count: 0,
        first_payout: r.payout.timestamp,
        last_payout: r.payout.timestamp,
      };
      lpMap.set(sp, lp);
    }
    lp.payout_count += 1;
    lp.total_paid_out_xtz += r.payout.payout_amount_xtz || 0;
    if (r.payout.timestamp < lp.first_payout) lp.first_payout = r.payout.timestamp;
    if (r.payout.timestamp > lp.last_payout) lp.last_payout = r.payout.timestamp;

    if (r.status === 'completed') {
      lp.completed_count += 1;
      lp.realized_fees_xtz += r.payout.fee_xtz || 0;
    } else if (r.status === 'paid_awaiting_settlement' || r.status === 'payout_overdue_unsettled') {
      lp.awaiting_count += 1;
      lp.unrealized_fees_xtz += r.payout.fee_xtz || 0;
      lp.outstanding_count += 1;
      lp.outstanding_exposure_xtz += r.payout.payout_amount_xtz || 0;
      if (r.status === 'payout_overdue_unsettled') {
        lp.overdue_count += 1;
        lp.overdue_exposure_xtz += r.payout.payout_amount_xtz || 0;
      }
    } else {
      // LP paid but the record is in an anomaly state
      // (settled_to_unexpected_receiver, amount_mismatch, ...): the payout is
      // not known-recovered, so count it as outstanding exposure too.
      lp.anomaly_count += 1;
      lp.outstanding_count += 1;
      lp.outstanding_exposure_xtz += r.payout.payout_amount_xtz || 0;
    }
  }
  const lpSummary = [...lpMap.values()]
    .map((lp) => ({
      ...lp,
      total_paid_out_xtz: round6(lp.total_paid_out_xtz),
      realized_fees_xtz: round6(lp.realized_fees_xtz),
      unrealized_fees_xtz: round6(lp.unrealized_fees_xtz),
      outstanding_exposure_xtz: round6(lp.outstanding_exposure_xtz),
      overdue_exposure_xtz: round6(lp.overdue_exposure_xtz),
    }))
    .sort((a, b) => b.payout_count - a.payout_count);

  const meta = {
    ok: reconciliationErrors.length === 0,
    reconciliation_errors: reconciliationErrors,
    input_counts: {
      l2_events: l2Rows.length,
      payout_events: payoutRows.length,
      settle_events: settleRows.length,
      unknown_tag_events: unknownTagRows.length,
    },
    distinct_withdrawal_ids: allIds.size,
  };

  return { records, summary, lpSummary, anomalies, meta };
}

module.exports = {
  reconcileFastWithdrawals,
  decodePackedNat,
  STATUSES,
  ANOMALY_STATUSES: [...ANOMALY_STATUSES],
  DEFAULT_OVERDUE_DAYS,
  MUTEZ_PER_XTZ,
  WEI_PER_XTZ,
};
