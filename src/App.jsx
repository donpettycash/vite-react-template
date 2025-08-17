// App.jsx — BankerX Drive Dashboard (componentized, mobile-first)
import React, { useMemo, useRef, useState, useEffect } from "react";
import {
  ResponsiveContainer,
  LineChart as RLineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  AreaChart as RAreaChart,
  Area,
  BarChart as RBarChart,
  Bar,
  Legend,
  Cell,
} from "recharts";

/********************** Error Boundary **********************/
class ErrorBoundary extends React.Component {
  constructor(props){ super(props); this.state = { hasError: false, error: null, info: null }; }
  static getDerivedStateFromError(error){ return { hasError: true, error }; }
  componentDidCatch(error, info){ this.setState({ info }); console.error("BankerX ErrorBoundary:", error, info); }
  render(){
    if(this.state.hasError){
      return (
        <div className="p-4 m-4 border border-rose-300 bg-rose-50 rounded-xl text-rose-700">
          <div className="font-semibold mb-1">Something went wrong rendering the dashboard.</div>
          <div className="text-sm whitespace-pre-wrap">
            {String((this.state.error && this.state.error.message) || this.state.error)}
          </div>
          {this.state.info?.componentStack && (
            <details className="mt-2 text-xs opacity-75">
              <summary>Stack</summary>
              <pre>{this.state.info.componentStack}</pre>
            </details>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

/*************************** Helpers ***************************/
const fmt = (v, currency = "ZAR") =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency, maximumFractionDigits: 0 }).format(v || 0);

function sanitizeIntInput(s){
  const v = String(s).replace(/[^0-9]/g, '');
  return v === '' ? 0 : parseInt(v, 10);
}

// Clamp helper: deposit may not exceed price
function clampDeposit(val, price){
  return Math.max(0, Math.min(Number.isFinite(val) ? val : 0, Number.isFinite(price) ? price : 0));
}


// PMT with residual/balloon — validated with self-tests below
function pmtWithResidual({ price, deposit, rateAnnual, months, residualPct }) {
  const r = rateAnnual / 12;           // monthly rate
  const P = Math.max(0, price - deposit);
  const FV = P * residualPct;          // balloon at end
  if (months <= 0) return { pmt: 0, P, r, FV };
  if (r === 0)   return { pmt: (P - FV) / months, P, r, FV };
  const denom = 1 - Math.pow(1 + r, -months);
  const pmt = ((P - FV / Math.pow(1 + r, months)) * r) / denom;
  return { pmt, P, r, FV };
}

function buildFinanceSchedule({ price, deposit, rateAnnual, months, residualPct, pmt }) {
  const r = rateAnnual / 12;
  let bal = Math.max(0, price - deposit);
  const FV = bal * residualPct;
  const rows = [];
  let totalInterest = 0;
  for (let m = 1; m <= months; m++) {
    const interest = bal * r;
    let principalPay = pmt - interest;
    if (m === months) principalPay = Math.max(0, bal - FV); // leave balloon amount
    bal = +(bal - principalPay).toFixed(6); // keep precision until display
    totalInterest += interest;
    rows.push({
      month: m,
      remaining: +bal.toFixed(2),
      interest: +interest.toFixed(2),
      principal: +principalPay.toFixed(2),
      payment: +pmt.toFixed(2)
    });
  }
  return { rows, totalInterest: +totalInterest.toFixed(2), balloon: +FV.toFixed(2) };
}

function makeDepreciationCurve({ startPrice, years = 7, year1Drop = 0.18, subsequentDrop = 0.12 }) {
  const data = [{ year: 0, value: +startPrice.toFixed(2) }];
  let v = startPrice;
  for (let y = 1; y <= years; y++) {
    const rate = y === 1 ? year1Drop : subsequentDrop;
    v = v * (1 - rate);
    data.push({ year: y, value: +v.toFixed(2) });
  }
  return data;
}

/****************** Reusable UI Components ******************/
// Section wrapper
function SectionCard({ title, children, className = "" }){
  return (
    <section className={`rounded-2xl border p-4 md:p-6 bg-white ${className}`}>
      {title && <h2 className="font-medium mb-2">{title}</h2>}
      {children}
    </section>
  );
}

// Stat pill
function Stat({ label, value, tint }){
  const tintClasses =
    tint === 'red' ? 'bg-rose-50 border-rose-200 text-rose-700'
    : tint === 'green' ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
    : tint === 'slate' ? 'bg-slate-50 border-slate-200 text-slate-700'
    : 'bg-white border-gray-200 text-gray-900';
  const labelColor =
    tint === 'red' ? 'text-rose-700'
    : tint === 'green' ? 'text-emerald-700'
    : tint === 'slate' ? 'text-slate-700'
    : 'text-gray-500';
  return (
    <div className={`rounded-2xl border p-3 ${tintClasses}`}>
      <div className={`text-xs ${labelColor}`}>{label}</div>
      <div className="text-base font-semibold">{value}</div>
    </div>
  );
}


// Legend component for TCO chart with a black key (keeps bars blue/red)
function CostLegend(){
  return (
    <div className="flex items-center gap-2" style={{ fontSize: 10 }}>
      <span style={{ width: 10, height: 10, background: '#000', display: 'inline-block', borderRadius: 2 }} />
      <span className="text-gray-900">Cost / mo</span>
    </div>
  );
}

// Apple-like range slider with fill color and compact thumb
function Range({ min, max, step, value, onChange, ariaLabel }){
  const percent = ((value - min) / (max - min)) * 100;
  const style = {
    background: `linear-gradient(90deg, #0a84ff 0%, #0a84ff ${percent}%, #e5e7eb ${percent}%, #e5e7eb 100%)`
  };
  return (
    <input
      aria-label={ariaLabel}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={onChange}
      className="w-full"
      style={style}
    />
  );
}

// Specific control wrappers — easy to reference like files (PriceSlider.jsx etc.)
function PriceSlider({ value, onChange, min=100000, max=3000000, step=5000 }){
  return (
    <label className="block">
      <div className="flex justify-between text-sm mb-1"><span>Price</span><span className="font-medium">{fmt(value)}</span></div>
      <Range min={min} max={max} step={step} value={value} onChange={onChange} ariaLabel="Price" />
    </label>
  );
}

function DepositSlider({ value, onChange, max=3000000, price=0 }){
  const pct = price > 0 ? Math.round((value / price) * 100) : 0;
  return (
    <label className="block">
      <div className="flex justify-between text-sm mb-1">
        <span>Deposit</span>
        <span className="font-medium flex items-center gap-2">
          {fmt(value)}
          <span className="text-gray-500 text-xs">({pct}%)</span>
        </span>
      </div>
      <Range min={0} max={max} step={5000} value={value} onChange={onChange} ariaLabel="Deposit" />
    </label>
  );
}

function RateSlider({ value, onChange }){
  return (
    <label className="block">
      <div className="flex justify-between text-sm mb-1"><span>Interest Rate</span><span className="font-medium">{value.toFixed(1)}%</span></div>
      <Range min={4} max={24} step={0.1} value={value} onChange={onChange} ariaLabel="Interest Rate" />
    </label>
  );
}

function TermSlider({ value, onChange }){
  return (
    <label className="block">
      <div className="flex justify-between text-sm mb-1"><span>Term</span><span className="font-medium">{value} months</span></div>
      <Range min={12} max={96} step={1} value={value} onChange={onChange} ariaLabel="Term" />
    </label>
  );
}

function ResidualSlider({ value, onChange }){
  return (
    <label className="block">
      <div className="flex justify-between text-sm mb-1"><span>Residual / Balloon</span><span className="font-medium">{value}%</span></div>
      <Range min={0} max={45} step={1} value={value} onChange={onChange} ariaLabel="Residual / Balloon" />
    </label>
  );
}

/************** Runtime self-tests (non-blocking) **************/
function runSelfTests(){
  try {
    // Existing tests (unchanged)
    const A = pmtWithResidual({ price: 100000, deposit: 0, rateAnnual: 0.12, months: 12, residualPct: 0 });
    console.assert(A.pmt > 0 && Number.isFinite(A.pmt), "PMT should be positive/finite");
    const Z = pmtWithResidual({ price: 120000, deposit: 20000, rateAnnual: 0, months: 12, residualPct: 0 });
    console.assert(Math.abs(Z.pmt - 100000/12) < 0.5, "Zero-rate PMT should be principal/months");
    const FD = pmtWithResidual({ price: 200000, deposit: 200000, rateAnnual: 0.1, months: 60, residualPct: 0 });
    console.assert(Math.abs(FD.pmt) < 1e-9, "Full-deposit should give ~zero PMT");
    const p = pmtWithResidual({ price: 200000, deposit: 20000, rateAnnual: 0.10, months: 24, residualPct: 0.2 }).pmt;
    const S = buildFinanceSchedule({ price: 200000, deposit: 20000, rateAnnual: 0.10, months: 24, residualPct: 0.2, pmt: p });
    console.assert(S.rows.length === 24, "Schedule should have 'months' rows");
    const D = makeDepreciationCurve({ startPrice: 300000, years: 7 });
    console.assert(D.length === 8, "Depreciation array has 8 points (0..7 years)");

    // Additional tests
    const interestSum = S.rows.reduce((a, r) => a + r.interest, 0);
    console.assert(Math.abs(interestSum - S.totalInterest) < 1, "Interest sum matches totalInterest");

    const lastRemaining = S.rows[S.rows.length - 1].remaining;
    console.assert(Math.abs(lastRemaining - S.balloon) < 1, "Last remaining equals balloon");

    const yearlyAgg = (() => {
      const out = [];
      const totalYears = Math.ceil(24 / 12);
      for (let y = 1; y <= totalYears; y++) {
        const start = (y - 1) * 12;
        const slice = S.rows.slice(start, start + 12);
        out.push({
          Interest: slice.reduce((a, r) => a + r.interest, 0),
          Capital: slice.reduce((a, r) => a + r.principal, 0)
        });
      }
      return out;
    })();
    const yearlyInterest = yearlyAgg.reduce((a,d)=>a+d.Interest,0);
    const yearlyPrincipal = yearlyAgg.reduce((a,d)=>a+d.Capital,0);
    const directInterest = S.rows.reduce((a,r)=>a+r.interest,0);
    const directPrincipal = S.rows.reduce((a,r)=>a+r.principal,0);
    console.assert(Math.abs(yearlyInterest - directInterest) < 1, "Yearly interest aggregation matches");
    console.assert(Math.abs(yearlyPrincipal - directPrincipal) < 1, "Yearly principal aggregation matches");

    const formatted = fmt(1234.56, 'ZAR');
    console.assert(!/\./.test(formatted), "ZAR currency formatting has no decimals");

    // NEW tests
    // PV identity: PV(payments) + PV(balloon) ~= Principal
    const T = pmtWithResidual({ price: 200000, deposit: 20000, rateAnnual: 0.10, months: 24, residualPct: 0.2 });
    const pvAnnuity = T.pmt * (1 - Math.pow(1 + T.r, -24)) / T.r;
    const pvBalloon = T.FV / Math.pow(1 + T.r, 24);
    console.assert(Math.abs((pvAnnuity + pvBalloon) - T.P) < 1, "PV of payments + balloon ~= principal");

    // Period-scaling outflow sanity test (96m vs 60m)
    const T96 = pmtWithResidual({ price: 300000, deposit: 50000, rateAnnual: 0.12, months: 96, residualPct: 0.15 });
    const S96 = buildFinanceSchedule({ price: 300000, deposit: 50000, rateAnnual: 0.12, months: 96, residualPct: 0.15, pmt: T96.pmt });
    const out96 = Math.round(T96.pmt) * 96 + Math.round(S96.balloon) + 50000;
    const out60 = Math.round(T96.pmt) * 60 + Math.round(S96.balloon) + 50000;
    console.assert(out96 > out60, "Total outflow scales with term (96m > 60m)");

    // Monotonic balance decrease to balloon
    for (let i = 1; i < S.rows.length; i++) {
      console.assert(S.rows[i].remaining <= S.rows[i-1].remaining + 0.01, "Balance should not increase");
    }

    // Input sanitization — no leading zeros
    console.assert(sanitizeIntInput('005') === 5, "sanitizeIntInput strips leading zeros");

    // Partial-year aggregation appears on the X-axis (e.g., 40 months => 4 years)
    const monthsTest = 40; const yearsCalc = Math.ceil(monthsTest / 12);
    console.assert(yearsCalc === 4, "Final partial year is included on the scale");

    // Deposit > price uses effective min(price, deposit)
    const priceT = 200000, depT = 250000; const depEff = Math.min(depT, priceT);
    const T2 = pmtWithResidual({ price: priceT, deposit: depEff, rateAnnual: 0.10, months: 60, residualPct: 0 });
    console.assert(T2.P === priceT - depEff, "Effective principal uses min(deposit, price)");

    // Deposit clamp tests
    console.assert(clampDeposit(250000, 200000) === 200000, "Deposit clamps to price upper bound");
    console.assert(clampDeposit(-10, 200000) === 0, "Deposit clamps to 0 lower bound");

    // Deposit percent display math
    const pctTest = Math.round((300000/1000000)*100);
    console.assert(pctTest === 30, "Deposit % display rounds to whole percent");

    console.log("BankerX self-tests passed.");
  } catch (e) { console.warn("BankerX self-tests failed:", e); }
}

/*************************** App ***************************/
export default function BankerXDrive(){
  const [title] = useState("BankerX Drive Dashboard");

  // Vehicle/base
  const currency = "ZAR";
  const [model, setModel] = useState("");
  const [price, setPrice] = useState(100000);

  // Finance
  const [deposit, setDeposit] = useState(50000);
  const [ratePct, setRatePct] = useState(12.0); // show 1 decimal in UI
  const [months, setMonths] = useState(35);
  const [residualPct, setResidualPct] = useState(29);

  // TCO
  const [insMonthly, setInsMonthly] = useState(1800);
  const [fuelMonthly, setFuelMonthly] = useState(2800);
  const [maintMonthly, setMaintMonthly] = useState(1200);
  const [licenceMonthly, setLicenceMonthly] = useState(180);

  // Budget
  const [budgetMonthly, setBudgetMonthly] = useState(9000);

  // Image
  const [imageUrl, setImageUrl] = useState(null);
  const fileRef = useRef(null);

  // Clamp deposit to not exceed price when price changes
  useEffect(() => { setDeposit(d => clampDeposit(d, price)); }, [price]);

  // Derived/calcs — declare effective deposit BEFORE using it anywhere
  const depositEff = Math.min(deposit, price);

  // Payment + stats
  const { pmt, P, FV } = useMemo(
    () => pmtWithResidual({ price, deposit: depositEff, rateAnnual: ratePct/100, months, residualPct: residualPct/100 }),
    [price, depositEff, ratePct, months, residualPct]
  );

  const schedule = useMemo(
    () => buildFinanceSchedule({ price, deposit: depositEff, rateAnnual: ratePct/100, months, residualPct: residualPct/100, pmt }),
    [price, depositEff, ratePct, months, residualPct, pmt]
  );

  // Aggregate by year for Interest vs Capital split (show final partial year)
  const yearlyData = useMemo(() => {
    const out = [];
    const totalYears = Math.ceil(months / 12);
    for (let y = 1; y <= totalYears; y++) {
      const start = (y - 1) * 12;
      const slice = schedule.rows.slice(start, start + 12);
      const interestY = Math.round(slice.reduce((a, r) => a + r.interest, 0));
      const principalY = Math.round(slice.reduce((a, r) => a + r.principal, 0));
      out.push({ year: y, Interest: interestY, Capital: principalY, Total: interestY + principalY });
    }
    return out;
  }, [schedule.rows, months]);

  const [year1Drop, setYear1Drop] = useState(18);
  const [subDrop, setSubDrop] = useState(12);
  const depCurve = useMemo(
    () => makeDepreciationCurve({ startPrice: price, years: 7, year1Drop: year1Drop/100, subsequentDrop: subDrop/100 }),
    [price, year1Drop, subDrop]
  );

  const financeMonthly = Math.round(pmt || 0);
  const ownershipMonthly = Math.round(insMonthly + fuelMonthly + maintMonthly + licenceMonthly);
  const totalMonthly = financeMonthly + ownershipMonthly;
  const totalOutflow = totalMonthly * months + Math.round(schedule.balloon) + Math.round(deposit);
  const fits = budgetMonthly >= totalMonthly;
  const gap = Math.abs(totalMonthly - budgetMonthly);

  function onPickFile(e){
    const files = e?.target?.files;
    const f = files && files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = function(){ setImageUrl(String(reader.result)); };
    reader.readAsDataURL(f);
  }

  function exportPDF(){ if (typeof window !== "undefined" && window.print) window.print(); }

  useEffect(() => { runSelfTests(); }, []);

  // helper for 5-year value
  function valueAfter5Years(){
    const p = depCurve.find(d => d.year === 5);
    return p ? p.value : 0;
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen w-full bg-white text-gray-900">
        <style>{`
          /* Minimalist Apple-like sliders with compact thumb */
          input[type=range] { -webkit-appearance: none; height: 6px; border-radius: 9999px; background: #e5e7eb; outline: none; }
          input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; border-radius: 9999px; background: #ffffff; box-shadow: 0 1px 2px rgba(0,0,0,0.12); border: 1px solid #d1d5db; }
          input[type=range]::-moz-range-thumb { width: 16px; height: 16px; border-radius: 9999px; background: #ffffff; box-shadow: 0 1px 2px rgba(0,0,0,0.12); border: 1px solid #d1d5db; }
          button { transition: box-shadow .15s ease, transform .05s ease; }
          button:hover { box-shadow: 0 4px 14px rgba(0,0,0,0.08); }
          button:active { transform: translateY(1px); }
        `}</style>

        {/* Header */}
        <header className="flex items-center justify-between p-4 border-b bg-gray-50 sticky top-0 z-10">
          <h1 className="text-xl font-semibold">{title}</h1>
        </header>

        <main className="mx-auto max-w-7xl p-6 md:p-8 grid gap-6">
          {/* Top: Image + Model/Price */}
          <div className="grid lg:grid-cols-2 gap-6">
            <SectionCard title="Car Photo / Model" className="bg-gray-50">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm text-gray-600">Tip: Upload a photo of the car (or paste from clipboard).</div>
                <button className="px-3 py-2 rounded-xl border bg-white shadow-sm" onClick={() => fileRef.current && fileRef.current.click()}>
                  Upload Photo
                </button>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickFile}/>
              </div>
              {imageUrl && <img src={imageUrl} alt="Car" className="w-full h-auto rounded-xl shadow mb-3"/>}
              <label className="block">
                <div className="text-xs text-gray-600 mb-1">Model</div>
                <input value={model} onChange={(e)=>setModel(e.target.value)} className="w-full rounded-xl border px-3 py-2 bg-yellow-50" placeholder="e.g. Toyota Hilux"/>
              </label>
              <div className="mt-3">
                <PriceSlider value={price} onChange={(e)=>setPrice(+e.target.value)} />
              </div>
            </SectionCard>

            {/* Finance Calculator */}
            <SectionCard title="Finance Calculator">
              <div className="grid md:grid-cols-2 gap-4">
                {/* decoupled: deposit slider max is fixed; it won't move when price changes */}
                <DepositSlider value={deposit} onChange={(e)=>setDeposit(clampDeposit(+e.target.value, price))} max={price} price={price} />
                <RateSlider value={ratePct} onChange={(e)=>setRatePct(+e.target.value)} />
                <TermSlider value={months} onChange={(e)=>setMonths(+e.target.value)} />
                <ResidualSlider value={residualPct} onChange={(e)=>setResidualPct(+e.target.value)} />
              </div>

              <div className="grid sm:grid-cols-4 gap-3 mt-4">
                <Stat label="Monthly Instalment" value={fmt(Math.round(pmt||0))} />
                <Stat label="Loan Amount" value={fmt(P)} />
                <Stat label="Balloon (end)" value={fmt(FV)} />
                <Stat label="Total Interest (est.)" value={fmt(schedule.totalInterest)} />
              </div>

              {/* Home Loan Split: Interest vs Capital per Year */}
              <div className="mt-4 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <RLineChart data={yearlyData} margin={{ top: 10, right: 16, left: 8, bottom: 8 }}>
                    <CartesianGrid stroke="#eef2f7" />
                    <XAxis dataKey="year" tick={{ fontSize: 10 }} label={{ value: "Year", position: "insideBottom", offset: -4, style: { fontSize: 10, fill: '#6b7280' } }} />
                    <YAxis domain={[0, 'dataMax']} allowDecimals={false} tick={{ fontSize: 11 }} tickFormatter={(v)=> new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 0 }).format(v)} />
                    <Tooltip formatter={(v)=> fmt(v, currency)} />
                    <Legend verticalAlign="top" height={24} wrapperStyle={{ fontSize: 10, color: '#6b7280' }} />
                    <Line type="monotone" dataKey="Interest" stroke="#1e40af" strokeWidth={2.25} dot={false} />
                    <Line type="monotone" dataKey="Capital" stroke="#16a34a" strokeWidth={2.25} dot={false} />
                  </RLineChart>
                </ResponsiveContainer>
              </div>
            </SectionCard>
          </div>

          {/* Middle: Depreciation + TCO */}
          <div className="grid lg:grid-cols-2 gap-6">
            <SectionCard title="Depreciation Curve">
              <div className="grid md:grid-cols-3 gap-4">
                <label className="block">
                  <div className="flex justify-between text-sm mb-1">
                    <span>Year 1 Drop</span><span className="font-medium">{year1Drop}%</span>
                  </div>
                  <Range min={5} max={35} step={1} value={year1Drop} onChange={(e)=>setYear1Drop(+e.target.value)} ariaLabel="Year 1 Drop" />
                </label>
                <label className="block">
                  <div className="flex justify-between text-sm mb-1">
                    <span>Subsequent Drop</span><span className="font-medium">{subDrop}%</span>
                  </div>
                  <Range min={5} max={25} step={1} value={subDrop} onChange={(e)=>setSubDrop(+e.target.value)} ariaLabel="Subsequent Drop" />
                </label>
                <Stat label="Value after 5y" value={fmt(valueAfter5Years())} />
              </div>
              <div className="mt-4 h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <RAreaChart data={depCurve} margin={{ top: 10, right: 16, left: 8, bottom: 8 }}>
                    <defs>
                      <linearGradient id="depFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#1e40af" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#eef2f7" />
                    <XAxis dataKey="year" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 11 }} domain={[0, 'dataMax']} allowDecimals={false} tickFormatter={(v)=> new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 0 }).format(v)} />
                    <Tooltip formatter={(v)=> fmt(v, currency)} />
                    <Area type="monotone" dataKey="value" stroke="#1e40af" strokeWidth={2.25} fill="url(#depFill)" />
                  </RAreaChart>
                </ResponsiveContainer>
              </div>
              <p className="text-xs text-gray-500 mt-2">Many new cars can lose 15–20% of their value in year 1 & roughly 50% by year 5 (estimate)</p>
            </SectionCard>

            <SectionCard title="Total Cost of Ownership (TCO)">
              <div className="grid md:grid-cols-4 gap-3">
                <label className="block">
                  <div className="text-xs text-gray-600 mb-1">Insurance / mo</div>
                  <input type="number" className="w-full rounded-xl border px-3 py-2 bg-yellow-50"
                         value={insMonthly} onChange={(e)=>setInsMonthly(sanitizeIntInput(e.target.value))} min={0} step={1} inputMode="numeric" pattern="[0-9]*"/>
                </label>
                <label className="block">
                  <div className="text-xs text-gray-600 mb-1">Fuel / mo</div>
                  <input type="number" className="w-full rounded-xl border px-3 py-2 bg-yellow-50"
                         value={fuelMonthly} onChange={(e)=>setFuelMonthly(sanitizeIntInput(e.target.value))} min={0} step={1} inputMode="numeric" pattern="[0-9]*"/>
                </label>
                <label className="block">
                  <div className="text-xs text-gray-600 mb-1">Maintenance / mo</div>
                  <input type="number" className="w-full rounded-xl border px-3 py-2 bg-yellow-50"
                         value={maintMonthly} onChange={(e)=>setMaintMonthly(sanitizeIntInput(e.target.value))} min={0} step={1} inputMode="numeric" pattern="[0-9]*"/>
                </label>
                <label className="block">
                  <div className="text-xs text-gray-600 mb-1">Licence / mo</div>
                  <input type="number" className="w-full rounded-xl border px-3 py-2 bg-yellow-50"
                         value={licenceMonthly} onChange={(e)=>setLicenceMonthly(sanitizeIntInput(e.target.value))} min={0} step={1} inputMode="numeric" pattern="[0-9]*"/>
                </label>
              </div>
              <div className="grid sm:grid-cols-4 gap-3 mt-4">
                <Stat label="Finance / mo" value={fmt(financeMonthly)} />
                <Stat label="Ownership / mo" value={fmt(ownershipMonthly)} />
                <Stat label="Total / mo" value={fmt(totalMonthly)} tint="red" />
                <Stat label={"Total outflow"} value={fmt(totalOutflow)} tint="slate" />
              </div>

              {/* TCO — minimalist legend, Total bar dark red */}
              <div className="mt-4 h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <RBarChart
                    data={[
                      { name: "Finance",   v: financeMonthly },
                      { name: "Ownership", v: ownershipMonthly },
                      { name: "Total",     v: totalMonthly }
                    ]}
                    margin={{ top: 10, right: 16, left: 8, bottom: 24 }}
                  >
                    <CartesianGrid stroke="#eef2f7" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 11 }} domain={[0, 'dataMax']} allowDecimals={false} tickFormatter={(v)=> new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 0 }).format(v)} />
                    <Tooltip formatter={(v)=> fmt(v, currency)} /><Bar dataKey="v" name="Cost / mo" radius={[6,6,0,0]} fill="#0a84ff">
                      {[
                        { name: "Finance",   v: financeMonthly },
                        { name: "Ownership", v: ownershipMonthly },
                        { name: "Total",     v: totalMonthly }
                      ].map((d, i) => (
                        <Cell key={i} fill={d.name === 'Total' ? '#7f1d1d' : '#1e3a8a'} />
                      ))}
                    </Bar>
                  </RBarChart>
                </ResponsiveContainer>
              </div>
            </SectionCard>
          </div>

          {/* Bottom: Budget Fit */}
          <SectionCard title="Budget Fit Checker">
            <div className="grid md:grid-cols-3 gap-4">
              <div className="md:col-span-2 grid gap-4">
                <label className="block">
                  <div className="text-xs text-gray-600 mb-1">Your Monthly Budget</div>
                  <input type="number" className="w-full rounded-xl border px-3 py-2 bg-yellow-50"
                         value={budgetMonthly} onChange={(e)=>setBudgetMonthly(sanitizeIntInput(e.target.value))} min={0} step={1} inputMode="numeric" pattern="[0-9]*"/>
                </label>
                <Stat label="Gap / Headroom" value={`${fmt(Math.abs(totalMonthly - budgetMonthly))} ${budgetMonthly >= totalMonthly ? 'headroom' : 'over'}`} />
              </div>
              <div>
                <Stat label="Status" value={fits ? 'Within budget' : 'Over budget'} tint={fits ? 'green' : 'red'} />
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-2">Tip: aim to be comfortably below budget to account for increased finance costs & emergencies</p>
          </SectionCard>

          {/* Export */}
          <div className="no-print mt-2 flex justify-center">
            <button onClick={exportPDF} className="px-4 py-2 rounded-xl border bg-white shadow-sm hover:shadow" title="Export this dashboard to PDF">
              Export to PDF
            </button>
          </div>

          <div className="text-xs text-gray-500 text-center">
            All figures are educational estimates. For exact quotes, consult your lender/dealer.
          </div>
        </main>
      </div>
    </ErrorBoundary>
  );
}
