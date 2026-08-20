import './InsiderActivity.css'

// ── Verdict appearance config ─────────────────────────────────────────────────
const VERDICT_STYLE = {
  BULLISH:       { color: '#10b981', bg: '#00100a', border: '#065f46', icon: '▲' },
  'LEAN BULLISH':{ color: '#34d399', bg: '#011209', border: '#047857', icon: '↑' },
  CAUTIOUS:      { color: '#f59e0b', bg: '#120c01', border: '#4d3800', icon: '⚠' },
  BEARISH:       { color: '#ef4444', bg: '#130202', border: '#7f1d1d', icon: '▼' },
  MIXED:         { color: '#60a5fa', bg: '#011128', border: '#1e3a8a', icon: '↔' },
  NEUTRAL:       { color: '#6b7280', bg: '#080d18', border: '#1e2d45', icon: '—' },
  UNKNOWN:       { color: '#3a5878', bg: '#080d18', border: '#1a2d45', icon: '?' },
}

// Transaction badge config — open-market ones get stronger colors
const TX_BADGE = {
  P: { label: 'OPEN BUY',  color: '#10b981', bg: '#011209', border: '#065f46' },
  S: { label: 'OPEN SELL', color: '#ef4444', bg: '#130202', border: '#7f1d1d' },
  D: { label: 'SELL BACK', color: '#f87171', bg: '#130202', border: '#7f1d1d' },
  A: { label: 'GRANT',     color: '#60a5fa', bg: '#011128', border: '#1e3a8a' },
  M: { label: 'EXERCISE',  color: '#a78bfa', bg: '#0e0a1f', border: '#4c1d95' },
  F: { label: 'TAX SALE',  color: '#6b7280', bg: '#080d18', border: '#1e2d45' },
  G: { label: 'GIFT',      color: '#6b7280', bg: '#080d18', border: '#1e2d45' },
}
const TX_BADGE_DEFAULT = { label: 'OTHER', color: '#6b7280', bg: '#080d18', border: '#1e2d45' }

function txBadge(txCode) {
  return TX_BADGE[txCode] ?? TX_BADGE_DEFAULT
}

function relativeDate(dateStr) {
  if (!dateStr) return ''
  const d    = new Date(dateStr)
  const days = Math.round((Date.now() - d.getTime()) / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return '1d ago'
  if (days < 30)  return `${days}d ago`
  if (days < 60)  return '~1mo ago'
  return `${Math.round(days / 30)}mo ago`
}

function shortDate(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}

function fmtShares(n) {
  if (!n) return null
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M shs`
  if (n >= 1_000)     return `${Math.round(n / 1_000)}K shs`
  return `${n.toLocaleString()} shs`
}

function fmtValue(v) {
  if (!v || v === 0) return null
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000)     return `$${Math.round(v / 1_000)}K`
  return `$${v.toLocaleString()}`
}

function insiderRole(parsed) {
  if (!parsed) return null
  if (parsed.officerTitle) return parsed.officerTitle
  if (parsed.isDirector)   return 'Director'
  if (parsed.is10Pct)      return '10% Owner'
  return null
}

// ── Components ────────────────────────────────────────────────────────────────

function VerdictCard({ sentiment, ticker }) {
  if (!sentiment) return null
  const vs = VERDICT_STYLE[sentiment.verdict] ?? VERDICT_STYLE.UNKNOWN
  const { openBuys, openSells, totalBuyValue, totalSellValue,
    cSuiteNames, grants, exercises, taxSales, hasParsedData } = sentiment

  const sigBuys  = openBuys.length
  const sigSells = openSells.length
  const hasSignal = sigBuys > 0 || sigSells > 0

  return (
    <div className="ins-verdict" style={{ background: vs.bg, borderColor: vs.border }}
      data-tip={sentiment.whyItMatters ?? 'Hover individual transactions below to learn more about each filing.'}>

      {/* Verdict badge row */}
      <div className="ins-verdict-top">
        <div className="ins-verdict-badge-wrap">
          <span className="ins-verdict-icon" style={{ color: vs.color }}>{vs.icon}</span>
          <span className="ins-verdict-badge" style={{ color: vs.color }}>
            INSIDER SENTIMENT: {sentiment.verdict}
          </span>
        </div>
        {!hasParsedData && (
          <span className="ins-verdict-parse-note">Transaction details unavailable</span>
        )}
      </div>

      {/* One-sentence summary */}
      {sentiment.explanation && (
        <div className="ins-verdict-explanation">{sentiment.explanation}</div>
      )}

      {/* Tip (short context) */}
      {sentiment.tip && (
        <div className="ins-verdict-tip" style={{ color: vs.color }}>{sentiment.tip}</div>
      )}

      {/* Signal stats — only if we have parsed data */}
      {hasParsedData && (
        <div className="ins-verdict-stats">
          {sigBuys > 0 && (
            <div className="ins-vstat" style={{ borderColor: '#065f46', background: '#00100a' }}
              data-tip="Open-market purchases: the insider paid market price for shares using their own money. This is the most bullish Form 4 transaction type.">
              <span className="ins-vstat-lbl">Open Market Buys</span>
              <span className="ins-vstat-val" style={{ color: '#10b981' }}>
                {sigBuys} tx{totalBuyValue > 0 ? ` · ${fmtValue(totalBuyValue)}` : ''}
              </span>
              {cSuiteNames.length > 0 && (
                <span className="ins-vstat-sub">{cSuiteNames[0]}</span>
              )}
            </div>
          )}
          {sigSells > 0 && (
            <div className="ins-vstat" style={{ borderColor: '#7f1d1d', background: '#130202' }}
              data-tip="Open-market sales: shares sold at market price. Selling has many explanations (taxes, diversification, 10b5-1 plans) and is generally a weaker signal than buying. Judge it in context.">
              <span className="ins-vstat-lbl">Open Market Sells</span>
              <span className="ins-vstat-val" style={{ color: '#ef4444' }}>
                {sigSells} tx{totalSellValue > 0 ? ` · ${fmtValue(totalSellValue)}` : ''}
              </span>
            </div>
          )}
          {!hasSignal && (grants + exercises + taxSales > 0) && (
            <div className="ins-vstat" style={{ borderColor: '#1e2d45', background: '#080d18' }}
              data-tip="Routine transactions: grants (compensation), option exercises (pre-scheduled), and tax withholding sales (automatic). None of these represent a discretionary buy or sell decision — they carry no directional signal.">
              <span className="ins-vstat-lbl">Routine Transactions</span>
              <span className="ins-vstat-val" style={{ color: '#6b7280' }}>
                {grants > 0   ? `${grants} grant${grants > 1 ? 's' : ''}` : ''}
                {exercises > 0 ? ` · ${exercises} exercise${exercises > 1 ? 's' : ''}` : ''}
                {taxSales > 0  ? ` · ${taxSales} tax sale${taxSales > 1 ? 's' : ''}` : ''}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Beginner explanation */}
      {sentiment.whyItMatters && (
        <div className="ins-verdict-why">
          <span className="ins-verdict-why-label">What this means</span>
          <span className="ins-verdict-why-text">{sentiment.whyItMatters}</span>
        </div>
      )}
    </div>
  )
}

function FilingRow({ f, i }) {
  const p    = f.parsed  // parsed XML data, may be null
  const role = insiderRole(p)

  // Collect all meaningful transactions from this filing
  const txs = p?.transactions ?? []
  const primaryTx = txs.find(t => t.txCode === 'P' || t.txCode === 'S') ?? txs[0]

  const name = p?.insiderName ?? f.insiderName ?? null

  const totalValue  = txs.reduce((s, t) => s + (t.value ?? 0), 0)
  const totalShares = txs.reduce((s, t) => s + (t.shares ?? 0), 0)

  const dateStr  = shortDate(f.fileDate)
  const agoStr   = relativeDate(f.fileDate)
  const badge    = primaryTx ? txBadge(primaryTx.txCode) : null

  // If multiple transaction types, show a compound label
  const hasMultiple = txs.length > 1
  const multiTypes  = hasMultiple ? [...new Set(txs.map(t => t.txCode))] : []

  const txTip = primaryTx
    ? `${primaryTx.label}: ${p?.insiderName ?? 'Insider'} ${primaryTx.txCode === 'P' ? 'purchased' : primaryTx.txCode === 'S' ? 'sold' : 'filed'} ${fmtShares(primaryTx.shares) ?? ''} ${primaryTx.price ? `@ $${primaryTx.price.toFixed(2)}` : ''} ${primaryTx.value ? `(${fmtValue(primaryTx.value)})` : ''}`.trim()
    : 'Transaction details not yet loaded or unavailable for this filing'

  return (
    <div className={`ins-row${i % 2 === 0 ? '' : ' ins-row-alt'}`}>

      {/* Name + role */}
      <div className="ins-row-name-wrap">
        {name
          ? <span className="ins-row-name">{name}</span>
          : <span className="ins-row-name ins-row-name-unknown">Unknown Filer</span>
        }
        {role && <span className="ins-row-role">{role}</span>}
      </div>

      {/* Transaction badge */}
      <span className="ins-row-tx" data-tip={txTip}>
        {badge ? (
          <span className="ins-tx-badge"
            style={{ color: badge.color, background: badge.bg, borderColor: badge.border }}>
            {badge.label}
            {hasMultiple && <span className="ins-tx-multi">+{txs.length - 1}</span>}
          </span>
        ) : (
          <span className="ins-tx-badge ins-tx-unknown">
            {p === null && f.accession ? 'PARSING…' : '—'}
          </span>
        )}
      </span>

      {/* Value */}
      <span className="ins-row-value"
        data-tip={totalShares > 0 ? `${totalShares.toLocaleString()} shares${totalValue > 0 ? ` · ${fmtValue(totalValue)} total value` : ''}` : null}>
        {totalValue > 0 ? fmtValue(totalValue) : totalShares > 0 ? fmtShares(totalShares) : '—'}
      </span>

      {/* Date */}
      <span className="ins-row-date" data-tip={`Filed ${dateStr} · Report date: ${shortDate(f.reportDate)}`}>
        <span className="ins-date-main">{dateStr}</span>
        <span className="ins-date-ago">{agoStr}</span>
      </span>

      {/* Link */}
      {f.filingUrl
        ? <a className="ins-row-link" href={f.filingUrl} target="_blank" rel="noopener noreferrer"
            data-tip="Open the original Form 4 filing on SEC EDGAR — the official government filing site. You can see every detail of the transaction including footnotes.">
            SEC ↗
          </a>
        : <span className="ins-row-link-none">—</span>
      }
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
function ShortInterestCard({ si }) {
  if (!si) {
    return (
      <div className="ins-si-card ins-si-loading">
        <span className="ins-si-lbl">SHORT INTEREST</span>
        <span className="ins-si-empty">Loading from Yahoo Finance…</span>
      </div>
    )
  }

  const pct    = si.shortPct
  const dtc    = si.daysToCover
  const mom    = si.mom
  const shares = si.sharesShort
  const prior  = si.priorShares

  const pctColor = pct == null ? '#4a6888'
    : pct >= 0.20 ? '#ef4444'
    : pct >= 0.10 ? '#f59e0b'
    : '#10b981'
  const pctBg    = pct == null ? '#070d18' : pct >= 0.20 ? '#130305' : pct >= 0.10 ? '#100900' : '#01120a'
  const pctBord  = pct == null ? '#1a2d45' : pct >= 0.20 ? '#7f1d1d' : pct >= 0.10 ? '#4d3800' : '#065f46'

  const momLabel = mom != null ? `${mom >= 0 ? '+' : ''}${(mom * 100).toFixed(1)}%` : null
  const momColor = mom == null ? '#4a6888' : mom > 0.05 ? '#ef4444' : mom < -0.05 ? '#10b981' : '#f59e0b'

  return (
    <div className="ins-si-card" style={{ borderColor: pctBord, background: pctBg }}>
      <div className="ins-si-header">
        <span className="ins-si-lbl">SHORT INTEREST</span>
        {si.squeeze && <span className="ins-si-squeeze">⚡ SQUEEZE WATCH</span>}
        {si.settleDate && <span className="ins-si-date">as of {si.settleDate}</span>}
      </div>

      <div className="ins-si-stats">
        <div className="ins-si-stat" data-tip="Short % of Float — the percentage of tradeable shares (the 'float') that are currently sold short. Above 10% is elevated. Above 20% means significant bearish bets are in place — and potential squeeze fuel if the stock rises.">
          <span className="ins-si-stat-lbl">% of Float</span>
          <span className="ins-si-stat-val" style={{ color: pctColor }}>
            {pct != null ? `${(pct * 100).toFixed(1)}%` : '—'}
          </span>
        </div>
        <div className="ins-si-stat" data-tip="Days to Cover — the short interest divided by the average daily trading volume. This tells you how many days of average volume it would take for all short sellers to close their positions. Above 5 days creates significant squeeze risk if the stock starts rising.">
          <span className="ins-si-stat-lbl">Days to Cover</span>
          <span className="ins-si-stat-val" style={{ color: dtc != null ? (dtc >= 5 ? '#f59e0b' : '#10b981') : '#4a6888' }}>
            {dtc != null ? dtc.toFixed(1) : '—'}
          </span>
        </div>
        <div className="ins-si-stat" data-tip="Total shares currently sold short. Combined with % of Float this tells you the scale of the bearish bet against this stock.">
          <span className="ins-si-stat-lbl">Shares Short</span>
          <span className="ins-si-stat-val" style={{ color: '#8ab0cc' }}>{fmtShares(shares)}</span>
        </div>
        {momLabel && (
          <div className="ins-si-stat" data-tip="Month-over-month change in short interest. Rising shorts (positive) = more bearish conviction building. Falling shorts (negative) = short covering, often bullish for the stock.">
            <span className="ins-si-stat-lbl">MoM Change</span>
            <span className="ins-si-stat-val" style={{ color: momColor }}>{momLabel}</span>
          </div>
        )}
      </div>

      <div className="ins-si-explain">
        {si.squeeze
          ? `High short interest (${(pct * 100).toFixed(1)}% of float) combined with ${dtc?.toFixed(1)} days to cover creates squeeze risk. If the stock rallies, shorts are forced to buy to close — accelerating the move.`
          : pct != null && pct >= 0.20
          ? `${(pct * 100).toFixed(1)}% of the float is short — a significant bearish bet. This can mean real downward pressure OR explosive squeeze potential if a catalyst sends the stock higher.`
          : pct != null && pct >= 0.10
          ? `${(pct * 100).toFixed(1)}% short float is elevated. Monitor for a squeeze setup if price starts trending up on rising volume.`
          : pct != null
          ? `${(pct * 100).toFixed(1)}% short — low. Not much short-side conviction. Less squeeze fuel, less headwind.`
          : 'Short interest data not available for this ticker.'
        }
      </div>
    </div>
  )
}

export default function InsiderActivity({ data, ticker, isLoading, shortInterest }) {
  if (isLoading) return (
    <div className="ins-root">
      <div className="ins-loading">
        <div className="ins-loading-spinner" />
        <div className="ins-loading-text">
          <span>Fetching &amp; analyzing SEC Form 4 filings…</span>
          <span className="ins-loading-sub">Reading filing metadata, then parsing transaction XML for each filing</span>
        </div>
      </div>
    </div>
  )

  if (!ticker) return (
    <div className="ins-root">
      <div className="ins-empty">
        <div className="ins-empty-icon">📋</div>
        <div className="ins-empty-text">Load a ticker to see insider activity</div>
        <div className="ins-empty-sub">
          Form 4 filings from SEC EDGAR — real transactions by officers, directors, and large shareholders.
          The app reads each filing to tell you whether insiders are buying or selling.
        </div>
      </div>
    </div>
  )

  if (!data) return (
    <div className="ins-root">
      <ShortInterestCard si={shortInterest} />
      <div className="ins-empty">
        <div className="ins-empty-icon">📋</div>
        <div className="ins-empty-text">No Form 4 data available</div>
        <div className="ins-empty-sub">
          No results for {ticker}. ETFs, foreign issuers, and companies with no recent
          insider activity may not appear here.
        </div>
        <a className="ins-edgar-link"
          href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=&CIK=${encodeURIComponent(ticker)}&type=4&dateb=&owner=include&count=20`}
          target="_blank" rel="noopener noreferrer">
          Search EDGAR directly ↗
        </a>
      </div>
    </div>
  )

  const { total90d, insiders, filings, sentiment, startdt, enddt, edgarLink } = data
  const activityColor = total90d >= 5 ? '#10b981' : total90d >= 2 ? '#f59e0b' : '#6b7280'

  return (
    <div className="ins-root">
      {/* Header */}
      <div className="ins-header">
        <div className="ins-header-left">
          <span className="ins-header-ticker"
            data-tip={`${ticker} insider transaction history. Form 4 filings must be submitted within 2 business days of any trade by an officer, director, or 10%+ shareholder.`}>
            {ticker}
          </span>
          <span className="ins-header-sub">SEC Form 4 · Insider Transactions · Last 90 Days</span>
        </div>
        <div className="ins-header-right">
          <div className="ins-stat"
            data-tip="Total Form 4 filings found via SEC EDGAR in the last 90 days. A higher count means more insider activity. Note: one insider can file multiple forms.">
            <span className="ins-stat-lbl">Filings (90d)</span>
            <span className="ins-stat-val" style={{ color: activityColor }}>{total90d}</span>
          </div>
          <div className="ins-stat"
            data-tip="Number of distinct individuals who filed at least one Form 4 in this window.">
            <span className="ins-stat-lbl">Unique Insiders</span>
            <span className="ins-stat-val">{insiders.length}</span>
          </div>
          <div className="ins-stat"
            data-tip={`Showing filings from ${startdt} through ${enddt}.`}>
            <span className="ins-stat-lbl">Window</span>
            <span className="ins-stat-val" style={{ fontSize: 11, color: '#6b7280' }}>{startdt} – {enddt}</span>
          </div>
        </div>
      </div>

      {/* Short Interest — always shown when ticker is loaded */}
      <ShortInterestCard si={shortInterest} />

      {total90d === 0 ? (
        <div className="ins-none">
          No Form 4 filings found for {ticker} in the past 90 days.
          <br />
          <a href={edgarLink} target="_blank" rel="noopener noreferrer" className="ins-edgar-link">
            Check full EDGAR history ↗
          </a>
        </div>
      ) : (
        <>
          {/* ── VERDICT CARD — primary analysis ─────────────────────────────── */}
          <VerdictCard sentiment={sentiment} ticker={ticker} />

          {/* Activity level */}
          <div className="ins-activity-bar" style={{ borderColor: activityColor }}>
            <span className="ins-activity-dot" style={{ background: activityColor }} />
            <span className="ins-activity-text" style={{ color: activityColor }}>
              {total90d >= 5
                ? `HIGH ACTIVITY — ${total90d} filings in 90 days across ${insiders.length} insider${insiders.length > 1 ? 's' : ''}.`
                : total90d >= 2
                ? `MODERATE ACTIVITY — ${total90d} filing${total90d > 1 ? 's' : ''} in 90 days.`
                : `LOW ACTIVITY — ${total90d} filing in 90 days. Most insiders are quiet.`
              }
            </span>
          </div>

          {/* Who filed */}
          {insiders.length > 0 && (
            <div className="ins-section">
              <div className="ins-section-title">Active Insiders</div>
              <div className="ins-insiders-grid">
                {insiders.slice(0, 8).map(ins => (
                  <div key={ins.name} className="ins-insider-chip"
                    data-tip={`${ins.name} filed ${ins.count} Form 4${ins.count > 1 ? 's' : ''} in this window. Last filing: ${relativeDate(ins.lastDate)}.`}>
                    <span className="ins-chip-name">{ins.name}</span>
                    <span className="ins-chip-count">{ins.count} filing{ins.count > 1 ? 's' : ''}</span>
                    <span className="ins-chip-date">{relativeDate(ins.lastDate)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Filing table */}
          {filings.length > 0 && (
            <div className="ins-section">
              <div className="ins-section-title">Transaction Detail</div>
              <div className="ins-table">
                <div className="ins-row ins-table-hdr">
                  <span data-tip="Name of the officer, director, or major shareholder who filed this Form 4.">
                    Insider / Role
                  </span>
                  <span data-tip="Transaction type. OPEN BUY (code P) = purchased at market price using own money — most bullish. OPEN SELL (code S) = sold at market price. GRANT = received as compensation (neutral). EXERCISE = converted options to shares (neutral). TAX SALE = automatic shares withheld for taxes (neutral).">
                    Type
                  </span>
                  <span data-tip="Dollar value of the transaction (shares × price). Open-market transactions with large dollar values carry more weight — a CEO buying $500K is more meaningful than a director buying $10K.">
                    Value / Size
                  </span>
                  <span data-tip="Date the Form 4 was filed with the SEC. Insiders must file within 2 business days of the transaction.">
                    Filed
                  </span>
                  <span>Link</span>
                </div>
                {filings.slice(0, 12).map((f, i) => (
                  <FilingRow key={f.accession ?? i} f={f} i={i} />
                ))}
              </div>
            </div>
          )}

          {/* What is Form 4 — beginner explainer */}
          <div className="ins-explainer"
            data-tip="SEC requires insiders (officers, directors, 10%+ shareholders) to report their trades within 2 business days. This transparency lets investors see what the company's own decision-makers are doing with their personal money.">
            <span className="ins-explainer-q">What is Form 4?</span>
            <span className="ins-explainer-a">
              A Form 4 is a federal disclosure that insiders must file within 2 business days of any trade.
              Open-market purchases (code P) are the most meaningful signal — an insider choosing to buy at market
              price with their own money suggests they believe the stock is undervalued.
              Selling is more nuanced and often reflects pre-planned programs or personal financial needs rather than bearish conviction.
            </span>
          </div>

          <div className="ins-footer">
            <a href={edgarLink} target="_blank" rel="noopener noreferrer" className="ins-edgar-link">
              View all Form 4 filings for {ticker} on SEC EDGAR ↗
            </a>
            <span className="ins-footer-note">
              Transaction data parsed directly from SEC Form 4 XML. Always verify on SEC.gov.
            </span>
          </div>
        </>
      )}
    </div>
  )
}
