import React, { useState, useMemo } from "react";
import Link from "next/link";
import TipJarButton from "../components/TipJarButton";

import etherlinkFastLogsCache from "../data/etherlinkFastLogsCache.json";
import tzktFastEventsCache from "../data/tzktFastEventsCache.json";
import { reconcileFastWithdrawals } from "../lib/fastWithdrawalRecon";

// Cap on the number of `completed` records shipped to the client. All
// non-completed records are always included in full; only the (very large)
// completed set is trimmed to the most recent N to keep page-data small.
const COMPLETED_CAP = 1000;

// Statuses in display order (used for the summary strip and filter buttons).
const STATUS_ORDER = [
  "completed",
  "paid_awaiting_settlement",
  "settled_direct",
  "pre_production",
  "pending",
  "payout_overdue_unsettled",
  "initiated_stale",
  "settled_to_unexpected_receiver",
  "l1_only",
  "amount_mismatch",
];

const STATUS_LABELS = {
  completed: "completed",
  paid_awaiting_settlement: "awaiting settlement",
  settled_direct: "settled direct",
  pre_production: "pre-production",
  pending: "pending",
  payout_overdue_unsettled: "payout overdue",
  initiated_stale: "initiated stale",
  settled_to_unexpected_receiver: "unexpected receiver",
  l1_only: "L1 only",
  amount_mismatch: "amount mismatch",
};

// Tailwind badge classes per status.
const STATUS_BADGE = {
  completed: "bg-green-600 text-white",
  paid_awaiting_settlement: "bg-blue-600 text-white",
  settled_direct: "bg-gray-500 text-white",
  pre_production: "bg-gray-600 text-white",
  pending: "bg-yellow-500 text-black",
  payout_overdue_unsettled: "bg-red-600 text-white",
  initiated_stale: "bg-red-600 text-white",
  settled_to_unexpected_receiver: "bg-red-600 text-white",
  l1_only: "bg-red-600 text-white",
  amount_mismatch: "bg-red-600 text-white",
};

const ETHERLINK_TX = "https://explorer.etherlink.com/tx/";
const TZKT = "https://tzkt.io/";

// ---------------------------------------------------------------------------
// build-time data prep
// ---------------------------------------------------------------------------

export async function getStaticProps() {
  const { records, summary, lpSummary, anomalies } = reconcileFastWithdrawals(
    etherlinkFastLogsCache,
    tzktFastEventsCache
  );

  // Trimmed row projection: only the fields the table renders / filters on.
  const projectRow = (r) => ({
    id: r.withdrawal_id,
    status: r.status,
    flags: r.flags && r.flags.length ? r.flags : null,
    date: r.l2 ? r.l2.timestamp_iso : null,
    ts: r.l2 && r.l2.timestamp ? r.l2.timestamp : 0,
    amount: r.amount_xtz,
    payout: r.payout ? r.payout.payout_amount_xtz : null,
    fee: r.payout ? r.payout.fee_xtz : null,
    lp: r.payout ? r.payout.service_provider : null,
    days: r.payout_to_settle_days,
    l2Hash: r.l2 ? r.l2.transaction_hash : null,
    payoutHash: r.payout ? r.payout.hash : null,
    settleHash: r.settle ? r.settle.hash : null,
    withdrawer: r.base_withdrawer,
    l2Caller: r.l2 ? r.l2.l2_caller : null,
  });

  const completed = [];
  const other = [];
  for (const r of records) {
    if (r.status === "completed") completed.push(r);
    else other.push(r);
  }
  // Newest-first by L2 timestamp.
  completed.sort((a, b) => (b.l2 ? b.l2.timestamp : 0) - (a.l2 ? a.l2.timestamp : 0));
  const completedTotal = completed.length;
  const completedShown = Math.min(COMPLETED_CAP, completedTotal);

  const rows = [...other, ...completed.slice(0, completedShown)]
    .map(projectRow)
    .sort((a, b) => b.ts - a.ts);

  // Enrich anomalies with record fields (amount / date / LP) for display.
  const recById = new Map(records.map((r) => [r.withdrawal_id, r]));
  const anomalyRows = anomalies.map((a) => {
    const rec = a.withdrawal_id != null ? recById.get(String(a.withdrawal_id)) : null;
    const d = a.detail || {};
    return {
      id: a.withdrawal_id,
      type: a.type,
      status: rec ? rec.status : null,
      amount: rec ? rec.amount_xtz : null,
      date: rec && rec.l2 ? rec.l2.timestamp_iso : null,
      lp: (rec && rec.payout && rec.payout.service_provider) || d.service_provider || null,
      l2Hash: (rec && rec.l2 && rec.l2.transaction_hash) || d.l2_tx || null,
      payoutHash: (rec && rec.payout && rec.payout.hash) || d.payout_hash || null,
      settleHash: (rec && rec.settle && rec.settle.hash) || d.settle_hash || null,
      detail: d,
    };
  });

  return {
    props: {
      summary,
      lpSummary,
      anomalyRows,
      rows,
      completedShown,
      completedTotal,
      l2Timestamp: etherlinkFastLogsCache.timestamp,
      l1Timestamp: tzktFastEventsCache.timestamp,
    },
  };
}

// ---------------------------------------------------------------------------
// formatting helpers
// ---------------------------------------------------------------------------

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  return date
    .toISOString()
    .replace(/:\d{2}\.\d{3}Z$/, "")
    .replace("T", " ");
}

function fmtXtz(x, dp = 6) {
  if (x === null || x === undefined) return "—";
  return Number(x).toLocaleString("en-US", { maximumFractionDigits: dp });
}

function fmtDate(iso) {
  if (!iso) return "—";
  return iso.replace(/:\d{2}\.\d{3}Z$/, "").replace(/:\d{2}Z$/, "").replace("T", " ");
}

function truncMid(str, head = 8, tail = 6) {
  if (!str) return "";
  if (str.length <= head + tail + 1) return str;
  return `${str.slice(0, head)}…${str.slice(-tail)}`;
}

function ageDays(iso, asOfIso) {
  if (!iso) return null;
  const now = asOfIso ? Date.parse(asOfIso) : Date.now();
  const days = (now - Date.parse(iso)) / 86400000;
  return Number.isFinite(days) ? days : null;
}

function fmtAge(iso, asOfIso) {
  const d = ageDays(iso, asOfIso);
  if (d === null) return "—";
  if (d < 1) return `${Math.round(d * 24)}h`;
  return `${d.toFixed(1)}d`;
}

// ---------------------------------------------------------------------------
// small presentational components
// ---------------------------------------------------------------------------

function StatusBadge({ status }) {
  const cls = STATUS_BADGE[status] || "bg-gray-600 text-white";
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs whitespace-nowrap ${cls}`}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}

function TxLink({ hash, base, label }) {
  if (!hash) return <span>—</span>;
  return (
    <a
      href={`${base}${hash}`}
      target="_blank"
      rel="noopener noreferrer"
      title={hash}
      className="underline text-blue-400 hover:text-blue-300"
    >
      {label}
    </a>
  );
}

function Addr({ value, base }) {
  if (!value) return <span>—</span>;
  const inner = <span title={value}>{truncMid(value)}</span>;
  if (!base) return inner;
  return (
    <a
      href={`${base}${value}`}
      target="_blank"
      rel="noopener noreferrer"
      title={value}
      className="underline text-blue-400 hover:text-blue-300"
    >
      {truncMid(value)}
    </a>
  );
}

// ---------------------------------------------------------------------------
// page
// ---------------------------------------------------------------------------

export default function FastWithdrawalsPage({
  summary,
  lpSummary,
  anomalyRows,
  rows,
  completedShown,
  completedTotal,
  l2Timestamp,
  l1Timestamp,
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const asOf = summary.as_of;
  const counts = summary.status_counts || {};
  const totals = summary.totals || {};

  const activeStatuses = STATUS_ORDER.filter((s) => (counts[s] || 0) > 0);

  const filteredRows = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (!term) return true;
      return [
        r.id,
        r.status,
        r.lp,
        r.withdrawer,
        r.l2Caller,
        r.l2Hash,
        r.payoutHash,
        r.settleHash,
      ]
        .filter(Boolean)
        .some((v) => v.toString().toLowerCase().includes(term));
    });
  }, [rows, searchTerm, statusFilter]);

  return (
    <div className="container mx-auto px-4 py-8">
      {/* 1. Title + tip jar */}
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-4xl font-bold">
          Etherlink Mainnet Fast Withdrawals Tracker
          <span className="block text-base font-normal mt-1">
            <Link href="/" className="underline text-blue-600">slow</Link>
            {" | "}
            <span className="font-bold">fast</span>
          </span>
        </h1>
        <div className="w-1/4 p-4 rounded-lg bg-gradient-to-r from-red-500 via-magenta-500 to-yellow-500 animate-text">
          <p className="text-white mb-2">Found this site helpful?</p>
          <TipJarButton tipAmount="1" />
        </div>
      </div>
      <div className="mb-4 border border-gray-300 p-4">
        <h2 className="text-2xl font-bold bg-gradient-to-r bg-clip-text text-transparent from-red-500 via-magenta-500 to-yellow-500 animate-text">
          FAST WITHDRAWALS (EXPERIMENTAL)
        </h2>
      </div>

      {/* 2. Status summary strip */}
      <div className="mb-6 border border-gray-300 p-4">
        <div className="flex flex-wrap gap-2 items-center mb-3">
          {STATUS_ORDER.filter((s) => (counts[s] || 0) > 0).map((s) => (
            <span key={s} className="flex items-center gap-1 text-sm">
              <StatusBadge status={s} />
              <span className="font-mono">{(counts[s] || 0).toLocaleString()}</span>
            </span>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span>
            Total withdrawals:{" "}
            <span className="font-mono">{summary.total_withdrawals.toLocaleString()}</span>
          </span>
          <span>
            Total amount:{" "}
            <span className="font-mono">{fmtXtz(totals.total_amount_xtz, 2)} XTZ</span>
          </span>
          <span>
            Paid out by LPs:{" "}
            <span className="font-mono">{fmtXtz(totals.total_paid_out_xtz, 2)} XTZ</span>
          </span>
          <span className="text-yellow-400">
            Outstanding (in flight):{" "}
            <span className="font-mono">{fmtXtz(totals.outstanding_exposure_xtz, 2)} XTZ</span>
          </span>
          {summary.anomaly_count > 0 && (
            <span className="text-red-400">
              Anomalies: <span className="font-mono">{summary.anomaly_count}</span>
            </span>
          )}
        </div>
      </div>

      {/* 3. Anomalies section */}
      {anomalyRows.length > 0 && (
        <div className="mb-6 border-2 border-red-600 p-4">
          <h2 className="text-xl font-bold text-red-400 mb-3">
            ⚠ Anomalies ({anomalyRows.length})
          </h2>
          <div className="overflow-x-auto">
            <table className="min-w-full border border-gray-300 border-collapse text-xs">
              <thead className="bg-black border-y-2 border-gray-300">
                <tr>
                  <th className="px-3 py-2 text-left">withdrawal_id</th>
                  <th className="px-3 py-2 text-left">type / status</th>
                  <th className="px-3 py-2 text-left">amount</th>
                  <th className="px-3 py-2 text-left">age</th>
                  <th className="px-3 py-2 text-left">LP</th>
                  <th className="px-3 py-2 text-left">links</th>
                  <th className="px-3 py-2 text-left">detail</th>
                </tr>
              </thead>
              <tbody>
                {anomalyRows.map((a, i) => (
                  <tr key={i} className="border-t border-gray-300">
                    <td className="px-3 py-2 font-mono">{a.id != null ? a.id : "—"}</td>
                    <td className="px-3 py-2">
                      <span className="inline-block px-2 py-0.5 rounded bg-red-600 text-white whitespace-nowrap">
                        {a.type}
                      </span>
                      {a.status && a.status !== a.type && (
                        <span className="ml-1 text-gray-400">({a.status})</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono whitespace-nowrap">
                      {fmtXtz(a.amount)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtAge(a.date, asOf)}</td>
                    <td className="px-3 py-2">
                      <Addr value={a.lp} base={TZKT} />
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <TxLink hash={a.l2Hash} base={ETHERLINK_TX} label="L2" />
                      {" · "}
                      <TxLink hash={a.payoutHash} base={TZKT} label="payout" />
                      {" · "}
                      <TxLink hash={a.settleHash} base={TZKT} label="settle" />
                    </td>
                    <td className="px-3 py-2 text-gray-400">
                      {a.detail && Object.keys(a.detail).length > 0
                        ? JSON.stringify(a.detail)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 4. LP summary table */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold mb-3">Liquidity Providers</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full border border-gray-300 border-collapse text-xs">
            <thead className="bg-black border-y-2 border-gray-300">
              <tr>
                <th className="px-3 py-2 text-left">service provider</th>
                <th className="px-3 py-2 text-right">payouts</th>
                <th className="px-3 py-2 text-right">paid out (XTZ)</th>
                <th className="px-3 py-2 text-right">realized fees</th>
                <th className="px-3 py-2 text-right">unrealized fees</th>
                <th className="px-3 py-2 text-right">outstanding (XTZ)</th>
                <th className="px-3 py-2 text-right">overdue</th>
              </tr>
            </thead>
            <tbody>
              {[...lpSummary]
                .sort((a, b) => b.total_paid_out_xtz - a.total_paid_out_xtz)
                .map((lp) => (
                  <tr key={lp.service_provider} className="border-t border-gray-300">
                    <td className="px-3 py-2">
                      <Addr value={lp.service_provider} base={TZKT} />
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {lp.payout_count.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {fmtXtz(lp.total_paid_out_xtz, 2)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {fmtXtz(lp.realized_fees_xtz, 4)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {fmtXtz(lp.unrealized_fees_xtz, 4)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {fmtXtz(lp.outstanding_exposure_xtz, 2)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono ${
                        lp.overdue_count > 0 ? "text-red-400" : ""
                      }`}
                    >
                      {lp.overdue_count}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 5. Withdrawals table */}
      <div className="mb-8">
        <div className="flex flex-wrap justify-between items-center gap-2 mb-3">
          <h2 className="text-2xl font-bold">Withdrawals</h2>
          <p className="text-xs text-gray-400">
            Showing latest {completedShown.toLocaleString()} of{" "}
            {completedTotal.toLocaleString()} completed, plus all non-completed records.
          </p>
        </div>

        <div className="flex flex-wrap gap-1 mb-3">
          <button
            onClick={() => setStatusFilter("all")}
            className={`px-2 py-1 text-xs border border-gray-400 rounded ${
              statusFilter === "all" ? "bg-white text-black" : ""
            }`}
          >
            All ({summary.total_withdrawals.toLocaleString()})
          </button>
          {activeStatuses.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-2 py-1 text-xs border border-gray-400 rounded ${
                statusFilter === s ? "bg-white text-black" : ""
              }`}
            >
              {STATUS_LABELS[s]} ({(counts[s] || 0).toLocaleString()})
            </button>
          ))}
        </div>

        <input
          type="text"
          placeholder="Filter by id / address / hash / status..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="mb-3 p-2 border border-gray-300 w-full max-w-md bg-transparent"
        />

        <div className="overflow-x-auto max-h-[36rem]">
          <table className="min-w-full border border-gray-300 border-collapse text-xs">
            <thead className="sticky -top-1 bg-black border-y-2 border-gray-300">
              <tr>
                <th className="px-3 py-2 text-left">id</th>
                <th className="px-3 py-2 text-left">status</th>
                <th className="px-3 py-2 text-left">initiated (L2)</th>
                <th className="px-3 py-2 text-right">amount (XTZ)</th>
                <th className="px-3 py-2 text-right">payout / fee</th>
                <th className="px-3 py-2 text-left">LP</th>
                <th className="px-3 py-2 text-right">payout→settle</th>
                <th className="px-3 py-2 text-left">links</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-gray-400" colSpan={8}>
                    No matching withdrawals.
                  </td>
                </tr>
              ) : (
                filteredRows.map((r) => (
                  <tr key={r.id} className="border-t border-gray-300">
                    <td className="px-3 py-2 font-mono">{r.id}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={r.status} />
                      {r.flags && (
                        <span
                          className="ml-1 text-red-400"
                          title={r.flags.join(", ")}
                        >
                          ⚑
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.date)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmtXtz(r.amount)}</td>
                    <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
                      {r.payout === null ? (
                        "—"
                      ) : (
                        <>
                          {fmtXtz(r.payout)}
                          <span className="text-gray-400"> / {fmtXtz(r.fee)}</span>
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Addr value={r.lp} base={TZKT} />
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {r.days === null ? "—" : `${Number(r.days).toFixed(1)}d`}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <TxLink hash={r.l2Hash} base={ETHERLINK_TX} label="L2" />
                      {" · "}
                      <TxLink hash={r.payoutHash} base={TZKT} label="payout" />
                      {" · "}
                      <TxLink hash={r.settleHash} base={TZKT} label="settle" />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 6. Footer */}
      <hr className="mb-2 mt-8" />
      <p className="mb-4 text-xs">
        BETA WARNING: Data might be wrong or out of date. Fast Withdrawals are
        experimental. Updated hourly: &nbsp;
        {formatTimestamp(l2Timestamp)} UTC (Etherlink L2)&nbsp;
        {formatTimestamp(l1Timestamp)} UTC (TzKT L1)&nbsp;
      </p>
      <p className="mb-4 text-xs">Source: Blockscout, TzKT API</p>
      <p className="mb-4 text-xs">
        Community tool by <a href="https://twitter.com/bors___">bors__nft</a>{" "}
        tz1fb6jz7rh4H7AojLShvhiXKaSNDyvkH7sM |
        0x4fb30f8cce1f80fc9cc45f7f626069be7549af59
      </p>
    </div>
  );
}
