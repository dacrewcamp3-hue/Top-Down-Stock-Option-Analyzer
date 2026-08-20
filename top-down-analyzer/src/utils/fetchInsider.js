// Fetches Form 4 (insider transaction) filings from SEC EDGAR.
// Phase 1: EFTS full-text search → filing metadata (name, date, accession).
// Phase 2: For each filing, fetch the primary XML from SEC Archives and parse
//          the actual transaction — type (buy/sell/grant), shares, price, role.
// Both data.sec.gov and www.sec.gov/Archives support CORS (Access-Control-Allow-Origin: *)
// so we call them directly without a proxy.

const EFTS_BASE = '/sec-efts'
const SEC_DATA  = 'https://data.sec.gov'
const SEC_ARCH  = 'https://www.sec.gov/Archives'

// Open-market transaction codes that carry directional signal
const TX_META = {
  P: { label: 'Open Market Purchase', sentiment: 'buy',     weight: 2  },
  S: { label: 'Open Market Sale',     sentiment: 'sell',    weight: 1  },
  D: { label: 'Sale to Company',      sentiment: 'sell',    weight: 1  },
  A: { label: 'Grant / Award',        sentiment: 'neutral', weight: 0  },
  M: { label: 'Option Exercise',      sentiment: 'neutral', weight: 0  },
  F: { label: 'Tax Withholding',      sentiment: 'neutral', weight: 0  },
  G: { label: 'Gift',                 sentiment: 'neutral', weight: 0  },
  J: { label: 'Other',                sentiment: 'neutral', weight: 0  },
}

function buildFilingUrl(accession) {
  if (!accession) return null
  const noDashes = accession.replace(/-/g, '')
  const cik      = String(parseInt(accession.split('-')[0], 10))
  if (!cik || !noDashes) return null
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${noDashes}/${noDashes}-index.htm`
}

function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

async function fetchWithTimeout(url, ms = 6000) {
  const ctrl  = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

function getTextEl(parent, selector) {
  return parent?.querySelector?.(selector)?.textContent?.trim() ?? null
}

function parseForm4XML(xmlText, knownReportDate) {
  try {
    // Form 4s are sometimes wrapped in an SGML envelope — strip to raw XML
    let raw = xmlText
    const xmlMatch = xmlText.match(/<XML>([\s\S]*?)<\/XML>/i)
    if (xmlMatch) raw = xmlMatch[1]

    const doc = new DOMParser().parseFromString(raw, 'application/xml')
    if (doc.querySelector('parsererror')) return null

    const getVal = sel => doc.querySelector(sel)?.textContent?.trim() ?? null

    const insiderName  = getVal('rptOwnerName')
    const isDirector   = getVal('isDirector') === '1'
    const isOfficer    = getVal('isOfficer')  === '1'
    const is10Pct      = getVal('is10PercentOwner') === '1'
    const officerTitle = getVal('officerTitle')
    const reportDate   = getVal('periodOfReport') ?? knownReportDate

    const transactions = []

    // Non-derivative (common stock) transactions
    doc.querySelectorAll('nonDerivativeTransaction').forEach(t => {
      const code    = getTextEl(t, 'transactionAcquiredDisposedCode value')
      const txCode  = getTextEl(t, 'transactionCode')
      const sharesS = getTextEl(t, 'transactionShares value')
      const priceS  = getTextEl(t, 'transactionPricePerShare value')
      const title   = getTextEl(t, 'securityTitle value') ?? 'Common Stock'

      const shares = parseFloat(sharesS ?? '0')
      const price  = parseFloat(priceS  ?? '0')
      if (!code || shares <= 0) return

      const meta = TX_META[txCode] ?? TX_META.J
      transactions.push({
        code,           // A = acquired, D = disposed
        txCode,         // P, S, A, M, F, G, D, J
        label:   meta.label,
        sentiment: meta.sentiment,
        weight:  meta.weight,
        shares:  Math.round(shares),
        price:   price > 0 ? price : null,
        value:   price > 0 ? Math.round(shares * price) : null,
        title,
      })
    })

    // Also capture derivative transactions (options/warrants) — these are typically neutral
    doc.querySelectorAll('derivativeTransaction').forEach(t => {
      const txCode  = getTextEl(t, 'transactionCode')
      const sharesS = getTextEl(t, 'transactionShares value') ??
                      getTextEl(t, 'derivativeSecurityConverted value')
      const priceS  = getTextEl(t, 'exercisePrice value')
      const title   = getTextEl(t, 'securityTitle value') ?? 'Derivative'

      const shares = parseFloat(sharesS ?? '0')
      const price  = parseFloat(priceS  ?? '0')
      if (shares <= 0) return

      const meta = TX_META[txCode] ?? TX_META.J
      transactions.push({
        code:      'A',
        txCode,
        label:     `${meta.label} (derivative)`,
        sentiment: 'neutral',
        weight:    0,
        shares:    Math.round(shares),
        price:     price > 0 ? price : null,
        value:     null,  // exercise price ≠ market value
        title,
        isDerivative: true,
      })
    })

    return { insiderName, isDirector, isOfficer, is10Pct, officerTitle, reportDate, transactions }
  } catch {
    return null
  }
}

async function enrichFiling(f) {
  if (!f.accession) return null
  const parts  = f.accession.split('-')
  const cikNum = parseInt(parts[0], 10)
  if (!cikNum || isNaN(cikNum)) return null
  const cik10  = String(cikNum).padStart(10, '0')
  const noDash = f.accession.replace(/-/g, '')

  try {
    // Fetch filer's submissions index — this tells us the primary document filename
    const subRes = await fetchWithTimeout(`${SEC_DATA}/submissions/CIK${cik10}.json`)
    if (!subRes.ok) return null
    const sub = await subRes.json()

    const recent = sub.filings?.recent ?? {}
    const accs   = recent.accessionNumber ?? []
    const idx    = accs.findIndex(a => a.replace(/-/g, '') === noDash)
    if (idx < 0) return null
    if (recent.form?.[idx] !== '4') return null

    const primaryDoc = recent.primaryDocument?.[idx]
    if (!primaryDoc) return null

    // Fetch and parse the actual Form 4 XML
    const xmlRes = await fetchWithTimeout(
      `${SEC_ARCH}/edgar/data/${cikNum}/${noDash}/${primaryDoc}`
    )
    if (!xmlRes.ok) return null
    const xmlText = await xmlRes.text()

    return parseForm4XML(xmlText, recent.reportDate?.[idx])
  } catch {
    return null
  }
}

// ── Sentiment analysis from parsed transaction data ────────────────────────────
function computeSentiment(parsedList) {
  const openBuys  = []
  const openSells = []
  let grants = 0, exercises = 0, taxSales = 0
  const buyerNames  = new Set()
  const sellerNames = new Set()
  const cSuiteNames = []

  for (const p of parsedList) {
    if (!p) continue
    const isCsuite = p.isOfficer && p.officerTitle &&
      ['CEO','CFO','COO','CTO','PRESIDENT','CHAIR','FOUNDER','GENERAL COUNSEL'].some(
        t => p.officerTitle.toUpperCase().includes(t)
      )

    for (const tx of p.transactions) {
      if (tx.isDerivative) continue
      if (tx.txCode === 'P') {
        openBuys.push({ ...tx, insiderName: p.insiderName, title: p.officerTitle,
          isOfficer: p.isOfficer, isDirector: p.isDirector })
        buyerNames.add(p.insiderName)
        if (isCsuite && p.officerTitle) cSuiteNames.push(`${p.officerTitle}: ${p.insiderName}`)
      } else if (tx.txCode === 'S' || tx.txCode === 'D') {
        openSells.push({ ...tx, insiderName: p.insiderName, title: p.officerTitle })
        sellerNames.add(p.insiderName)
      } else if (tx.txCode === 'A') grants++
      else if (tx.txCode === 'M') exercises++
      else if (tx.txCode === 'F') taxSales++
    }
  }

  const totalBuyValue  = openBuys.reduce((s, t)  => s + (t.value ?? 0), 0)
  const totalSellValue = openSells.reduce((s, t) => s + (t.value ?? 0), 0)
  const hasParsedData  = parsedList.some(p => p !== null)

  if (!hasParsedData) {
    return { verdict: 'UNKNOWN', hasParsedData: false,
      openBuys: [], openSells: [], totalBuyValue: 0, totalSellValue: 0,
      buyerNames: [], cSuiteNames: [], grants, exercises, taxSales }
  }

  let verdict, explanation, tip, whyItMatters

  if (openBuys.length > 0 && openSells.length === 0) {
    verdict     = 'BULLISH'
    explanation = `${openBuys.length} open-market purchase${openBuys.length > 1 ? 's' : ''} — no open-market selling detected.`
    tip         = buyerNames.size > 1
      ? `${buyerNames.size} different insiders chose to buy on the open market.`
      : `An insider used personal money to buy shares on the open market.`
    whyItMatters = 'Insiders who buy on the open market are using their own money — not compensation, not options — to make a personal bet that the stock will go up. They have access to internal information about the company\'s direction. Open-market buying is the most powerful bullish insider signal.'
  } else if (openBuys.length > 0 && totalBuyValue >= totalSellValue * 0.5) {
    verdict     = 'LEAN BULLISH'
    explanation = `Open-market buying detected alongside some selling. Buying${totalBuyValue > 0 && totalSellValue > 0 ? ` (${fmtVal(totalBuyValue)}) ` : ' '}present.`
    tip         = 'Net activity leans toward accumulation. Not as clean as pure buying but still a positive lean.'
    whyItMatters = 'Some insiders are buying on the open market even as others may be selling. Not all selling is bearish — insiders sell for many reasons (taxes, diversification, planned sales). The presence of open-market buying is a constructive signal.'
  } else if (openSells.length > 0 && openBuys.length === 0) {
    verdict     = 'CAUTIOUS'
    explanation = `${openSells.length} open-market sale${openSells.length > 1 ? 's' : ''} detected — no open-market buying.`
    tip         = 'Insider selling present. Important: selling is often pre-planned and does not always signal bearish intent.'
    whyItMatters = 'Insiders sell for many reasons that have nothing to do with the stock\'s outlook — mortgage payments, portfolio diversification, estate planning, and pre-scheduled 10b5-1 selling programs. Selling alone is NOT a strong bearish signal. However, if combined with weak price action or other bearish signals, it adds caution.'
  } else if (openSells.length > 0 && totalSellValue > totalBuyValue * 2) {
    verdict     = 'BEARISH'
    explanation = `Open-market selling significantly outpaces buying in dollar terms.`
    tip         = `Selling outpaces buying by over 2:1 in dollar value.`
    whyItMatters = 'When multiple insiders are selling on the open market at prices significantly greater than any buying, and especially when large position holders are reducing exposure, it can reflect reduced internal confidence. This is most meaningful when combined with other bearish signals.'
  } else if (openBuys.length === 0 && openSells.length === 0) {
    verdict     = 'NEUTRAL'
    explanation = `Only routine transactions found — no discretionary buying or selling.`
    tip         = 'No open-market activity. Grants, exercises, and tax withholdings are mechanical and carry no directional signal.'
    whyItMatters = 'Grants are how companies compensate executives — receiving stock for free is not the same as choosing to BUY it. Option exercises and tax withholding sales are pre-programmed events. None of these reflect the insider\'s personal conviction about the stock\'s near-term direction.'
  } else {
    verdict     = 'MIXED'
    explanation = `Both open-market buying and selling present.`
    tip         = totalBuyValue > totalSellValue
      ? 'Buying outpaces selling in dollar terms — slight positive lean.'
      : 'Selling outpaces buying in dollar terms — slight cautious lean.'
    whyItMatters = 'Mixed signals — look at the dollar amounts. A CEO buying $2M in stock while a departing VP sells $200K is still a net-bullish signal. Context matters more than raw counts here.'
  }

  return {
    verdict, explanation, tip, whyItMatters, hasParsedData,
    openBuys, openSells, totalBuyValue, totalSellValue,
    buyerNames: [...buyerNames], sellerNames: [...sellerNames],
    cSuiteNames, grants, exercises, taxSales,
  }
}

function fmtVal(v) {
  if (!v || v === 0) return null
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000)     return `$${Math.round(v / 1_000)}K`
  return `$${v.toLocaleString()}`
}

export async function fetchInsiderActivity(ticker) {
  try {
    const startdt = daysAgo(90)
    const enddt   = new Date().toISOString().slice(0, 10)
    const sym     = ticker.toUpperCase()

    // ── Phase 1: EFTS search — fast, ~300ms ──────────────────────────────────
    const url = `${EFTS_BASE}/LATEST/search-index?q=%22${encodeURIComponent(sym)}%22&forms=4&dateRange=custom&startdt=${startdt}&enddt=${enddt}`
    const res = await fetch(url)
    if (!res.ok) return null
    const json = await res.json()

    const hits  = json.hits?.hits ?? []
    const total = json.hits?.total?.value ?? 0

    const rawFilings = hits.slice(0, 12).map(h => {
      const src = h._source ?? {}
      const accession = h._id ?? null
      return {
        insiderName: src.entity_name || src.display_names?.[0] || null,
        fileDate:    src.file_date   ?? null,
        reportDate:  src.period_of_report ?? null,
        accession,
        filingUrl:   buildFilingUrl(accession),
      }
    })

    // Deduplicate
    const seen = new Set()
    const unique = rawFilings.filter(f => {
      if (!f.accession || seen.has(f.accession)) return false
      seen.add(f.accession); return true
    })

    // ── Phase 2: Enrich each filing with XML parsing ──────────────────────────
    const parsed = await Promise.all(unique.map(f => enrichFiling(f).catch(() => null)))

    const enrichedFilings = unique.map((f, i) => ({
      ...f,
      parsed: parsed[i] ?? null,
    }))

    // Aggregate per-insider across filings
    const byInsider = {}
    for (const f of enrichedFilings) {
      const name = f.insiderName || 'Unknown Filer'
      if (!byInsider[name]) byInsider[name] = { name, filings: [] }
      byInsider[name].filings.push(f)
    }
    const insiderList = Object.values(byInsider)
      .sort((a, b) => b.filings.length - a.filings.length)
      .map(item => ({
        name:     item.name,
        count:    item.filings.length,
        lastDate: item.filings.map(f => f.fileDate).filter(Boolean).sort().reverse()[0] ?? null,
      }))

    // ── Sentiment from parsed transaction data ────────────────────────────────
    const sentiment = computeSentiment(parsed)

    const edgarLink = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=&CIK=${encodeURIComponent(sym)}&type=4&dateb=&owner=include&count=20`

    return {
      ticker: sym,
      total90d: total,
      filings:  enrichedFilings,
      insiders: insiderList,
      sentiment,
      startdt,
      enddt,
      edgarLink,
    }
  } catch { return null }
}
