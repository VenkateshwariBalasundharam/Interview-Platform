export interface DonutPart {
  label: string;
  value: number;
  color: string;
}

/** A ring chart drawn with plain SVG. The big number in the middle is the total. */
export function Donut({ parts, centre, caption }: { parts: DonutPart[]; centre: string; caption: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const r = 52;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg viewBox="0 0 140 140" className="h-36 w-36 shrink-0 -rotate-90" role="img" aria-label={`${caption}: ${parts.map((p) => `${p.label} ${p.value}`).join(', ')}`}>
        <circle cx="70" cy="70" r={r} fill="none" stroke="#eef1f6" strokeWidth="16" />
        {total > 0 &&
          parts
            .filter((p) => p.value > 0)
            .map((p) => {
              const len = (p.value / total) * c;
              const el = <circle key={p.label} cx="70" cy="70" r={r} fill="none" stroke={p.color} strokeWidth="16" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} />;
              offset += len;
              return el;
            })}
        <g transform="rotate(90 70 70)">
          <text x="70" y="70" textAnchor="middle" className="fill-foreground text-[22px] font-semibold">{centre}</text>
          <text x="70" y="88" textAnchor="middle" className="fill-slate-500 text-[9px]">{caption}</text>
        </g>
      </svg>
      <ul className="min-w-[10rem] flex-1 space-y-1.5 text-sm">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} aria-hidden />
            <span className="text-muted-foreground">{p.label}</span>
            <span className="ml-auto font-medium tabular-nums">{p.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
