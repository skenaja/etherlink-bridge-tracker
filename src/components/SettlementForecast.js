import React, { useEffect, useMemo, useRef, useState } from "react";

// Projected LP liquidity release: when paid-but-unsettled fast withdrawals
// settle back to the provider that fronted them. Data comes from
// lib/settlementForecast.js via getStaticProps.

const H = 3600;
const D = 86400;
const ALL = "all";
const TIMINGS = [
  ["p10", "early (p10)"],
  ["p50", "typical (p50)"],
  ["p90", "late (p90)"],
];
const BAR = "#2563eb";
const BAR_HOVER = "#60a5fa";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const dt = (t) => new Date(t * 1000);
const dayLabel = (t) => `${MON[dt(t).getUTCMonth()]} ${dt(t).getUTCDate()}`;
const wkDay = (t) => `${WK[dt(t).getUTCDay()]} ${dayLabel(t)}`;
const hm = (t) =>
  `${String(dt(t).getUTCHours()).padStart(2, "0")}:${String(dt(t).getUTCMinutes()).padStart(2, "0")}`;

function fmtXtz(mutez, dp) {
  const x = mutez / 1e6;
  const max = dp != null ? dp : x >= 100 ? 0 : 2;
  return x.toLocaleString("en-US", { maximumFractionDigits: max });
}

function short(x) {
  const a = Math.abs(x);
  if (a >= 1e6) return `${(x / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (a >= 1e3) return `${(x / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, "")}k`;
  return String(Math.round(x));
}

function niceMax(v) {
  if (v <= 0) return { max: 1, step: 1 };
  const raw = v / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / mag;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  const step = nf * mag;
  return { max: Math.ceil(v / step) * step, step };
}

function bucketize(rows, delays, timing, now, end, step) {
  const start = Math.floor(now / step) * step;
  const n = Math.ceil((end - start) / step);
  const out = Array.from({ length: n }, (_, i) => ({ t: start + i * step, sum: 0, n: 0, max: 0, cum: 0 }));
  for (const [wts, full, lpIdx] of rows) {
    const eta = Math.max(wts + delays[lpIdx][timing], now);
    const i = Math.floor((eta - start) / step);
    if (i < 0 || i >= n) continue;
    const b = out[i];
    b.sum += full;
    b.n += 1;
    if (full > b.max) b.max = full;
  }
  let c = 0;
  for (const b of out) {
    c += b.sum;
    b.cum = c;
  }
  return out;
}

function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(900);
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(320, Math.floor(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function Tip({ tip }) {
  if (!tip) return null;
  return (
    <div
      className="absolute pointer-events-none z-10 bg-black text-white border border-gray-500 rounded px-2 py-1 text-xs whitespace-nowrap"
      style={{ left: tip.x, top: tip.y, transform: tip.flip ? "translate(-100%, -110%)" : "translate(8px, -110%)" }}
    >
      <div className="text-gray-400 mb-0.5">{tip.title}</div>
      {tip.items.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4">
          <span className="text-gray-300">{k}</span>
          <span className="font-bold">{v}</span>
        </div>
      ))}
    </div>
  );
}

function YAxis({ nm, m, W, ih }) {
  const ticks = [];
  for (let v = 0; v <= nm.max + 1e-9; v += nm.step) ticks.push(v);
  return ticks.map((v) => {
    const y = m.t + ih - (v / nm.max) * ih;
    return (
      <g key={v}>
        <line x1={m.l} x2={W - m.r} y1={y} y2={y} stroke="currentColor" strokeOpacity={v === 0 ? 0.6 : 0.15} />
        <text x={m.l - 6} y={y + 4} textAnchor="end" fill="currentColor" fontSize="11">
          {short(v)}
        </text>
      </g>
    );
  });
}

function DayTicks({ t0, t1, xOf, m, ih, W }) {
  const out = [];
  const every = W < 560 ? 3 : (t1 - t0) / D > 10 ? 2 : 1;
  let i = 0;
  for (let t = Math.ceil(t0 / D) * D; t <= t1; t += D, i++) {
    const x = xOf(t);
    out.push(
      <g key={t}>
        <line x1={x} x2={x} y1={m.t + ih} y2={m.t + ih + 4} stroke="currentColor" strokeOpacity={0.6} />
        {i % every === 0 && (
          <text x={x} y={m.t + ih + 17} textAnchor="middle" fill="currentColor" fontSize="11">
            {dayLabel(t)}
          </text>
        )}
      </g>
    );
  }
  return out;
}

function ReleaseBars({ buckets, hourly }) {
  const [ref, W] = useWidth();
  const [hover, setHover] = useState(-1);
  const Hh = 260;
  const m = { l: 48, r: 8, t: 14, b: 28 };
  const iw = W - m.l - m.r;
  const ih = Hh - m.t - m.b;
  const nm = niceMax(Math.max(...buckets.map((b) => b.sum)) / 1e6);
  const bw = iw / buckets.length;
  const gap = hourly ? (bw > 4 ? 1 : 0) : 2;
  const t0 = buckets[0].t;
  const t1 = t0 + buckets.length * (hourly ? H : D);
  const xOf = (t) => m.l + ((t - t0) / (t1 - t0)) * iw;
  const yOf = (mutez) => m.t + ih - (mutez / 1e6 / nm.max) * ih;

  const onMove = (e) => {
    const r = e.currentTarget.ownerSVGElement.getBoundingClientRect();
    const i = Math.floor(((e.clientX - r.left) * (W / r.width) - m.l) / bw);
    if (i >= 0 && i < buckets.length) setHover(i);
  };
  const onKey = (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const d = e.key === "ArrowRight" ? 1 : -1;
    setHover((h) => Math.max(0, Math.min(buckets.length - 1, h < 0 ? 0 : h + d)));
  };

  let tip = null;
  if (hover >= 0) {
    const b = buckets[hover];
    const x = m.l + (hover + 0.5) * bw;
    tip = {
      x,
      y: yOf(b.sum),
      flip: x > W * 0.7,
      title: hourly ? `${wkDay(b.t)} ${hm(b.t)}–${hm(b.t + H)} UTC` : `${wkDay(b.t)} (UTC)`,
      items: [
        ["released", `${fmtXtz(b.sum)} XTZ`],
        ["withdrawals", String(b.n)],
        ["largest", b.n ? `${fmtXtz(b.max)} XTZ` : "—"],
        ["cumulative", `${fmtXtz(b.cum)} XTZ`],
      ],
    };
  }

  return (
    <div ref={ref} className="relative w-full">
      <svg viewBox={`0 0 ${W} ${Hh}`} width="100%" role="img" aria-label="XTZ released per bucket" className="block overflow-visible">
        <YAxis nm={nm} m={m} W={W} ih={ih} />
        {buckets.map((b, i) => {
          if (!b.sum) return null;
          const x = m.l + i * bw + gap / 2;
          const w = Math.max(1, bw - gap);
          const y = yOf(b.sum);
          const h = m.t + ih - y;
          const r = Math.min(3, w / 2, h);
          const base = m.t + ih;
          return (
            <g key={b.t}>
              <path
                d={`M${x},${base} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${base} Z`}
                fill={i === hover ? BAR_HOVER : BAR}
              />
              {!hourly && bw > 34 && (
                <text x={x + w / 2} y={y - 4} textAnchor="middle" fill="currentColor" fontSize="11">
                  {short(b.sum / 1e6)}
                </text>
              )}
            </g>
          );
        })}
        {hourly ? (
          <DayTicks t0={t0} t1={t1} xOf={xOf} m={m} ih={ih} W={W} />
        ) : (
          buckets.map((b, i) =>
            i % (W < 560 ? 3 : 1) === 0 ? (
              <text key={b.t} x={m.l + (i + 0.5) * bw} y={m.t + ih + 17} textAnchor="middle" fill="currentColor" fontSize="11">
                {dayLabel(b.t)}
              </text>
            ) : null
          )
        )}
        <rect
          x={m.l}
          y={m.t}
          width={iw}
          height={ih}
          fill="transparent"
          tabIndex={0}
          aria-label="Release chart, use arrow keys"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(-1)}
          onBlur={() => setHover(-1)}
          onKeyDown={onKey}
        />
      </svg>
      <Tip tip={tip} />
    </div>
  );
}

function CumulativeChart({ series, total, now, end }) {
  const [ref, W] = useWidth();
  const [hover, setHover] = useState(-1);
  const Hh = 220;
  const m = { l: 48, r: 8, t: 18, b: 28 };
  const iw = W - m.l - m.r;
  const ih = Hh - m.t - m.b;
  const nm = niceMax(total / 1e6);
  const xOf = (t) => m.l + ((Math.min(Math.max(t, now), end) - now) / (end - now)) * iw;
  const yOf = (mutez) => m.t + ih - (mutez / 1e6 / nm.max) * ih;
  const pts = (s) => s.map((b) => [xOf(b.t + H), yOf(b.cum)]);
  const up = pts(series.p10);
  const lo = pts(series.p90);
  const mid = pts(series.p50);
  const start = [xOf(now), yOf(0)];
  const line = (arr) => arr.map((p) => p.join(",")).join(" L");
  const band = `M${line([start, ...up])} L${line([...lo].reverse())} L${start.join(",")} Z`;

  const onMove = (e) => {
    const r = e.currentTarget.ownerSVGElement.getBoundingClientRect();
    const px = (e.clientX - r.left) * (W / r.width);
    let best = 0;
    let bd = Infinity;
    mid.forEach((p, i) => {
      const d = Math.abs(p[0] - px);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    setHover(best);
  };
  const onKey = (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const d = e.key === "ArrowRight" ? 6 : -6;
    setHover((h) => Math.max(0, Math.min(mid.length - 1, h < 0 ? 0 : h + d)));
  };

  let tip = null;
  if (hover >= 0) {
    const te = series.p50[hover].t + H;
    tip = {
      x: mid[hover][0],
      y: mid[hover][1],
      flip: mid[hover][0] > W * 0.7,
      title: `by ${wkDay(te)} ${hm(te)} UTC`,
      items: [
        ["typical", `${fmtXtz(series.p50[hover].cum)} XTZ`],
        ["early", `${fmtXtz(series.p10[hover].cum)} XTZ`],
        ["late", `${fmtXtz(series.p90[hover].cum)} XTZ`],
        ["still locked", `${fmtXtz(total - series.p50[hover].cum)} XTZ`],
      ],
    };
  }
  const last = mid[mid.length - 1];

  return (
    <div ref={ref} className="relative w-full">
      <svg viewBox={`0 0 ${W} ${Hh}`} width="100%" role="img" aria-label="Cumulative XTZ released" className="block overflow-visible">
        <YAxis nm={nm} m={m} W={W} ih={ih} />
        <path d={band} fill={BAR} fillOpacity={0.22} />
        <path d={`M${line([start, ...mid])}`} fill="none" stroke={BAR} strokeWidth={2} strokeLinejoin="round" />
        <DayTicks t0={now} t1={end} xOf={xOf} m={m} ih={ih} W={W} />
        <text x={last[0] - 4} y={last[1] - 6} textAnchor="end" fill="currentColor" fontSize="11">
          {fmtXtz(total, 0)} XTZ
        </text>
        {hover >= 0 && (
          <>
            <line x1={mid[hover][0]} x2={mid[hover][0]} y1={m.t} y2={m.t + ih} stroke="currentColor" strokeOpacity={0.5} />
            <circle cx={mid[hover][0]} cy={mid[hover][1]} r={4} fill={BAR} stroke="currentColor" strokeWidth={1.5} />
          </>
        )}
        <rect
          x={m.l}
          y={m.t}
          width={iw}
          height={ih}
          fill="transparent"
          tabIndex={0}
          aria-label="Cumulative chart, use arrow keys"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(-1)}
          onBlur={() => setHover(-1)}
          onKeyDown={onKey}
        />
      </svg>
      <Tip tip={tip} />
    </div>
  );
}

function Seg({ value, options, onChange, label }) {
  return (
    <div role="group" aria-label={label} className="inline-flex border border-gray-400 rounded overflow-hidden">
      {options.map(([v, text], i) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={`px-2 py-1 text-xs ${i ? "border-l border-gray-400" : ""} ${value === v ? "bg-white text-black" : ""}`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function truncMid(str, head = 8, tail = 6) {
  if (!str || str.length <= head + tail + 1) return str || "";
  return `${str.slice(0, head)}…${str.slice(-tail)}`;
}

export default function SettlementForecast({ forecast }) {
  const { asOf: now, horizonDays, lps, rows: allRows } = forecast;
  const end = now + horizonDays * D;
  const [lpSel, setLpSel] = useState(lps.length ? lps[0].lp : ALL);
  const [gran, setGran] = useState("day");
  const [timing, setTiming] = useState("p50");

  const delays = useMemo(() => lps.map((l) => l.delay), [lps]);
  const lpIdx = lps.findIndex((l) => l.lp === lpSel);
  const rows = useMemo(
    () => (lpSel === ALL ? allRows : allRows.filter((r) => r[2] === lpIdx)),
    [allRows, lpSel, lpIdx]
  );

  const total = rows.reduce((s, r) => s + r[1], 0);
  const scope = lpSel === ALL ? lps : lps.filter((l) => l.lp === lpSel);
  const fee = scope.reduce((s, l) => s + l.feeMutez, 0);
  const overdue = scope.reduce((s, l) => s + l.overdueCount, 0);
  const beyond = rows.filter((r) => r[0] + delays[r[2]][timing] >= end);

  const bars = useMemo(
    () => (rows.length ? bucketize(rows, delays, timing, now, end, gran === "hour" ? H : D) : []),
    [rows, delays, timing, now, end, gran]
  );
  const daily = useMemo(
    () => (rows.length ? bucketize(rows, delays, timing, now, end, D) : []),
    [rows, delays, timing, now, end]
  );
  const cum = useMemo(
    () =>
      rows.length
        ? {
            p10: bucketize(rows, delays, "p10", now, end, H),
            p50: bucketize(rows, delays, "p50", now, end, H),
            p90: bucketize(rows, delays, "p90", now, end, H),
          }
        : null,
    [rows, delays, now, end]
  );

  const next24 = rows.filter((r) => r[0] + delays[r[2]][timing] < now + D);
  const next24Sum = next24.reduce((s, r) => s + r[1], 0);
  const peak = daily.reduce((a, b) => (b.sum > a.sum ? b : a), daily[0] || { sum: 0, n: 0, t: now });
  const maxDaily = Math.max(1, ...daily.map((b) => b.sum));
  const dsel = lpSel === ALL ? null : lps[lpIdx];

  if (!lps.length) {
    return (
      <div className="mb-8">
        <h2 className="text-2xl font-bold mb-3">Settlement Forecast</h2>
        <p className="text-sm">No paid-out withdrawals are awaiting settlement.</p>
      </div>
    );
  }

  return (
    <div className="mb-8">
      <div className="flex flex-wrap justify-between items-baseline gap-2 mb-3">
        <h2 className="text-2xl font-bold">Settlement Forecast</h2>
        <p className="text-xs opacity-70">
          LP liquidity freed by settlements over the next {horizonDays} days, from {wkDay(now)} {hm(now)} UTC
        </p>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2 items-center mb-4 text-xs">
        <label className="flex items-center gap-2">
          provider
          <select
            id="forecast-lp"
            value={lpSel}
            onChange={(e) => setLpSel(e.target.value)}
            className="px-2 py-1 border border-gray-400 rounded bg-transparent font-mono text-xs"
          >
            {lps.map((l) => (
              <option key={l.lp} value={l.lp} className="text-black">
                {truncMid(l.lp)} — {fmtXtz(l.totalMutez, 0)} XTZ
              </option>
            ))}
            {lps.length > 1 && (
              <option value={ALL} className="text-black">
                all providers
              </option>
            )}
          </select>
        </label>
        <span className="flex items-center gap-2">
          bucket
          <Seg label="Bucket size" value={gran} onChange={setGran} options={[["hour", "hourly"], ["day", "daily"]]} />
        </span>
        <span className="flex items-center gap-2">
          timing
          <Seg label="Settlement timing" value={timing} onChange={setTiming} options={TIMINGS} />
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 border border-gray-300 mb-4">
        {[
          ["awaiting settlement", `${fmtXtz(total, 0)} XTZ`, `${rows.length.toLocaleString()} withdrawals`],
          ["released next 24h", `${fmtXtz(next24Sum, 0)} XTZ`, `${next24.length} withdrawals by ${dayLabel(now + D)} ${hm(now + D)}`],
          ["busiest day", `${fmtXtz(peak.sum, 0)} XTZ`, `${wkDay(peak.t)}, ${peak.n} withdrawals`],
          ["fees embedded", `${fmtXtz(fee, 2)} XTZ`, "settled amount minus payout"],
        ].map(([k, v, note], i) => (
          <div key={k} className={`p-3 ${i ? "border-l border-gray-300" : ""} ${i === 2 ? "max-md:border-l-0 max-md:border-t" : ""} ${i === 3 ? "max-md:border-t" : ""}`}>
            <div className="text-xs uppercase opacity-70">{k}</div>
            <div className="text-xl font-bold font-mono">{v}</div>
            <div className="text-xs opacity-70">{note}</div>
          </div>
        ))}
      </div>

      {(overdue > 0 || beyond.length > 0) && (
        <p className="text-xs mb-3">
          {overdue > 0 && (
            <span className="text-red-400 mr-4">
              {overdue} overdue withdrawal{overdue === 1 ? "" : "s"} past the challenge window, charted as due now.
            </span>
          )}
          {beyond.length > 0 && (
            <span>
              {beyond.length} withdrawal{beyond.length === 1 ? "" : "s"} (
              {fmtXtz(beyond.reduce((s, r) => s + r[1], 0), 0)} XTZ) settle after the {horizonDays}-day window.
            </span>
          )}
        </p>
      )}

      <div className="border border-gray-300 p-3 mb-4">
        <div className="flex flex-wrap justify-between gap-2 mb-1 text-sm">
          <span className="font-bold">XTZ released per {gran === "hour" ? "hour" : "day"} (UTC)</span>
        </div>
        <ReleaseBars buckets={bars} hourly={gran === "hour"} />
      </div>

      <div className="border border-gray-300 p-3 mb-4">
        <div className="flex flex-wrap justify-between gap-2 mb-1 text-sm">
          <span className="font-bold">Cumulative XTZ released</span>
          <span className="flex gap-4 text-xs opacity-80">
            <span className="flex items-center gap-1">
              <i className="inline-block w-4 h-0.5" style={{ background: BAR }} /> typical (p50)
            </span>
            <span className="flex items-center gap-1">
              <i className="inline-block w-4 h-2.5 rounded-sm" style={{ background: BAR, opacity: 0.3 }} /> early to late (p10–p90)
            </span>
          </span>
        </div>
        {cum && <CumulativeChart series={cum} total={total} now={now} end={end} />}
      </div>

      <div className="overflow-x-auto mb-3">
        <table className="min-w-full border border-gray-300 border-collapse text-xs">
          <thead className="bg-black border-y-2 border-gray-300">
            <tr>
              <th className="px-3 py-2 text-left">day (UTC)</th>
              <th className="px-3 py-2 text-right">withdrawals</th>
              <th className="px-3 py-2 text-right">XTZ released</th>
              <th className="px-3 py-2 text-right">largest</th>
              <th className="px-3 py-2 text-right">cumulative</th>
              <th className="px-3 py-2 text-left">share</th>
            </tr>
          </thead>
          <tbody>
            {daily.map((b) => (
              <tr key={b.t} className={`border-t border-gray-300 ${b.n ? "" : "opacity-50"}`}>
                <td className="px-3 py-1.5 whitespace-nowrap">
                  {wkDay(b.t)}
                  {b.t < now ? ` (from ${hm(now)})` : ""}
                </td>
                <td className="px-3 py-1.5 text-right font-mono">{b.n}</td>
                <td className="px-3 py-1.5 text-right font-mono">{b.n ? fmtXtz(b.sum) : "—"}</td>
                <td className="px-3 py-1.5 text-right font-mono">{b.n ? fmtXtz(b.max) : "—"}</td>
                <td className="px-3 py-1.5 text-right font-mono">{fmtXtz(b.cum)}</td>
                <td className="px-3 py-1.5">
                  <span className="flex items-center gap-2">
                    <span
                      className="inline-block h-2 rounded-r"
                      style={{ width: `${(b.sum / maxDaily) * 8}rem`, background: BAR, visibility: b.sum ? "visible" : "hidden" }}
                    />
                    <span className="font-mono">{total ? ((b.sum / total) * 100).toFixed(1) : "0.0"}%</span>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs opacity-80 max-w-4xl">
        Each open withdrawal is projected as its L2 withdrawal time plus the withdrawal→settle delay
        {dsel && dsel.delaySource === "lp" ? " this provider has seen" : " seen across all providers"} over{" "}
        {(dsel ? dsel.delay : forecast.globalDelay).n.toLocaleString()} settlements in the last 120 days
        {(() => {
          const d = dsel ? dsel.delay : forecast.globalDelay;
          return ` (fastest ${(d.min / D).toFixed(2)}d, p10 ${(d.p10 / D).toFixed(2)}d, p50 ${(d.p50 / D).toFixed(2)}d, p90 ${(d.p90 / D).toFixed(2)}d, slowest ${(d.max / D).toFixed(2)}d)`;
        })()}
        . Settlements are executed in batches, so real releases arrive in clumps a few hours either side of
        the hour shown. Only withdrawals already paid out are counted; payouts made after this snapshot
        add to the end of the window.
      </p>
    </div>
  );
}
