// Chart pattern detection — operates on the already-sliced display window (last N bars).
// Returns an array of pattern objects with bar-index coordinates (not SVG pixels).
// Caller converts indices to SVG coords via xOf/yOf.

const SP = 4 // swing period: bars on each side for a local high/low

// Adam = sharp spike (few bars near the pivot); Eve = rounded/broad (many bars near the pivot).
// Pass h[] for tops, l[] for bottoms. Within ±4 bars, count how many are within 0.8% of the pivot.
function classifyShape(arr, idx, nb) {
  const pivot = arr[idx]
  const threshold = Math.abs(pivot) * 0.008
  let nearCount = 0
  for (let j = Math.max(0, idx - 4); j <= Math.min(nb - 1, idx + 4); j++) {
    if (j === idx) continue
    if (Math.abs(arr[j] - pivot) <= threshold) nearCount++
  }
  return nearCount <= 1 ? 'Adam' : 'Eve'
}

function swings(h, l, nb) {
  const highs = [], lows = []
  for (let i = SP; i < nb - SP; i++) {
    let isH = true, isL = true
    for (let j = i - SP; j <= i + SP; j++) {
      if (j === i) continue
      if (h[j] >= h[i]) isH = false
      if (l[j] <= l[i]) isL = false
    }
    if (isH) highs.push({ i, p: h[i] })
    if (isL) lows.push( { i, p: l[i] })
  }
  return { highs, lows }
}

// Linear regression over [{i, p}] → { slope, intercept, r2 }
function linReg(pts) {
  const n = pts.length
  if (n < 2) return null
  let sx = 0, sy = 0, sxy = 0, sx2 = 0
  for (const { i, p } of pts) { sx += i; sy += p; sxy += i * p; sx2 += i * i }
  const denom = n * sx2 - sx * sx
  if (Math.abs(denom) < 1e-10) return null
  const slope     = (n * sxy - sx * sy) / denom
  const intercept = (sy - slope * sx) / n
  const mean      = sy / n
  let ssTot = 0, ssRes = 0
  for (const { i, p } of pts) {
    ssTot += (p - mean) ** 2
    ssRes += (p - (slope * i + intercept)) ** 2
  }
  return { slope, intercept, r2: ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0 }
}

export function detectChartPatterns(h, l, c, nb) {
  if (nb < 20) return []
  const { highs: sH, lows: sL } = swings(h, l, nb)
  const patterns = []

  // ── Double Top ────────────────────────────────────────────────────────────
  ;(() => {
    for (let a = sH.length - 1; a >= 1; a--) {
      for (let b = a - 1; b >= 0; b--) {
        const p1 = sH[b], p2 = sH[a]
        const sep = p2.i - p1.i
        if (sep < 8 || sep > 55) continue
        const avg  = (p1.p + p2.p) / 2
        const diff = Math.abs(p1.p - p2.p) / avg
        if (diff > 0.025) continue
        const neck = sL.filter(s => s.i > p1.i && s.i < p2.i)
          .reduce((mn, s) => s.p < mn.p ? s : mn, { p: Infinity, i: 0 })
        if (!isFinite(neck.p)) continue
        const depth = (avg - neck.p) / avg
        if (depth < 0.03) continue
        const ago   = nb - 1 - p2.i
        // Adam & Eve is the most reliable variant — small bonus to its score
        const s1 = classifyShape(h, p1.i, nb)
        const s2 = classifyShape(h, p2.i, nb)
        const typeVariant = `${s1} & ${s2} Top`
        const aeBonus = (s1 === 'Adam' && s2 === 'Eve') || (s1 === 'Eve' && s2 === 'Adam') ? 5 : 0
        const score = Math.min(100, Math.round((1 - diff / 0.025) * 35 + Math.min(depth / 0.08, 1) * 35 + Math.max(0, 1 - ago / 45) * 30 + aeBonus))
        patterns.push({
          type: typeVariant, kind: 'bear', score,
          startI: p1.i, endI: p2.i,
          level1: avg, level2: neck.p, neck_i: neck.i,
          pivots: [{ i: p1.i, p: p1.p }, { i: p2.i, p: p2.p }, { i: neck.i, p: neck.p, neck: true }],
          labelI: p2.i, labelSide: 'top',
        })
        return
      }
    }
  })()

  // ── Double Bottom ─────────────────────────────────────────────────────────
  ;(() => {
    for (let a = sL.length - 1; a >= 1; a--) {
      for (let b = a - 1; b >= 0; b--) {
        const p1 = sL[b], p2 = sL[a]
        const sep = p2.i - p1.i
        if (sep < 8 || sep > 55) continue
        const avg  = (p1.p + p2.p) / 2
        const diff = Math.abs(p1.p - p2.p) / avg
        if (diff > 0.025) continue
        const neck = sH.filter(s => s.i > p1.i && s.i < p2.i)
          .reduce((mx, s) => s.p > mx.p ? s : mx, { p: -Infinity, i: 0 })
        if (!isFinite(neck.p) || neck.p < 0) continue
        const depth = (neck.p - avg) / neck.p
        if (depth < 0.03) continue
        const ago   = nb - 1 - p2.i
        const s1 = classifyShape(l, p1.i, nb)
        const s2 = classifyShape(l, p2.i, nb)
        const typeVariant = `${s1} & ${s2} Bottom`
        const aeBonus = (s1 === 'Adam' && s2 === 'Eve') || (s1 === 'Eve' && s2 === 'Adam') ? 5 : 0
        const score = Math.min(100, Math.round((1 - diff / 0.025) * 35 + Math.min(depth / 0.08, 1) * 35 + Math.max(0, 1 - ago / 45) * 30 + aeBonus))
        patterns.push({
          type: typeVariant, kind: 'bull', score,
          startI: p1.i, endI: p2.i,
          level1: avg, level2: neck.p, neck_i: neck.i,
          pivots: [{ i: p1.i, p: p1.p }, { i: p2.i, p: p2.p }, { i: neck.i, p: neck.p, neck: true }],
          labelI: p2.i, labelSide: 'bottom',
        })
        return
      }
    }
  })()

  // ── Head & Shoulders ──────────────────────────────────────────────────────
  ;(() => {
    for (let hi = sH.length - 1; hi >= 2; hi--) {
      const rs = sH[hi], hd = sH[hi - 1], ls = sH[hi - 2]
      if (hd.p <= ls.p || hd.p <= rs.p) continue
      const sDiff = Math.abs(ls.p - rs.p) / ((ls.p + rs.p) / 2)
      if (sDiff > 0.15) continue
      if (hd.i - ls.i < 8 || rs.i - hd.i < 8) continue
      const lV = sL.filter(s => s.i > ls.i && s.i < hd.i)
      const rV = sL.filter(s => s.i > hd.i && s.i < rs.i)
      if (!lV.length || !rV.length) continue
      const lN  = lV.reduce((mn, s) => s.p < mn.p ? s : mn)
      const rN  = rV.reduce((mn, s) => s.p < mn.p ? s : mn)
      const nl  = (lN.p + rN.p) / 2
      const dep = (hd.p - nl) / hd.p
      if (dep < 0.04) continue
      const ago   = nb - 1 - rs.i
      const score = Math.round((1 - sDiff / 0.15) * 40 + Math.min(dep / 0.1, 1) * 35 + Math.max(0, 1 - ago / 80) * 25)
      patterns.push({
        type: 'Head & Shoulders', kind: 'bear', score,
        startI: ls.i, endI: rs.i,
        level2: nl,
        pivots: [
          { i: ls.i, p: ls.p, label: 'LS' },
          { i: hd.i, p: hd.p, label: 'H'  },
          { i: rs.i, p: rs.p, label: 'RS' },
          { i: lN.i, p: lN.p, neck: true },
          { i: rN.i, p: rN.p, neck: true },
        ],
        labelI: hd.i, labelSide: 'top',
      })
      return
    }
  })()

  // ── Inverse Head & Shoulders ──────────────────────────────────────────────
  ;(() => {
    for (let li = sL.length - 1; li >= 2; li--) {
      const rs = sL[li], hd = sL[li - 1], ls = sL[li - 2]
      if (hd.p >= ls.p || hd.p >= rs.p) continue
      const sDiff = Math.abs(ls.p - rs.p) / ((ls.p + rs.p) / 2)
      if (sDiff > 0.15) continue
      if (hd.i - ls.i < 8 || rs.i - hd.i < 8) continue
      const lP = sH.filter(s => s.i > ls.i && s.i < hd.i)
      const rP = sH.filter(s => s.i > hd.i && s.i < rs.i)
      if (!lP.length || !rP.length) continue
      const lN  = lP.reduce((mx, s) => s.p > mx.p ? s : mx)
      const rN  = rP.reduce((mx, s) => s.p > mx.p ? s : mx)
      const nl  = (lN.p + rN.p) / 2
      const dep = (nl - hd.p) / nl
      if (dep < 0.04) continue
      const ago   = nb - 1 - rs.i
      const score = Math.round((1 - sDiff / 0.15) * 40 + Math.min(dep / 0.1, 1) * 35 + Math.max(0, 1 - ago / 80) * 25)
      patterns.push({
        type: 'Inv. Head & Shoulders', kind: 'bull', score,
        startI: ls.i, endI: rs.i,
        level2: nl,
        pivots: [
          { i: ls.i, p: ls.p, label: 'LS' },
          { i: hd.i, p: hd.p, label: 'H'  },
          { i: rs.i, p: rs.p, label: 'RS' },
          { i: lN.i, p: lN.p, neck: true },
          { i: rN.i, p: rN.p, neck: true },
        ],
        labelI: hd.i, labelSide: 'bottom',
      })
      return
    }
  })()

  // ── Triangle / Wedge / Rectangle (trendline analysis) ─────────────────────
  ;(() => {
    // Need at least 3 swing highs and 3 swing lows in the recent window
    const minStart = Math.max(SP, nb - 60)
    const recH = sH.filter(s => s.i >= minStart)
    const recL = sL.filter(s => s.i >= minStart)
    if (recH.length < 3 || recL.length < 3) return

    const uReg = linReg(recH)
    const lReg = linReg(recL)
    if (!uReg || !lReg) return

    // Both trendlines need R² ≥ 0.70 for a credible pattern
    if (uReg.r2 < 0.70 || lReg.r2 < 0.70) return

    const { slope: us, intercept: ui } = uReg
    const { slope: ls, intercept: li } = lReg

    // Upper line must stay above lower line at the midpoint
    const midI   = (recH[0].i + recH[recH.length - 1].i) / 2
    const uAtMid = us * midI + ui
    const lAtMid = ls * midI + li
    if (uAtMid <= lAtMid) return  // lines crossed — skip

    const startI = Math.min(recH[0].i,  recL[0].i)
    const endI   = Math.max(recH[recH.length - 1].i, recL[recL.length - 1].i)
    if (endI - startI < 12) return  // pattern too short

    const FLAT   = 0.015 / (endI - startI + 1)  // slope threshold — price-relative flatness
    const usFlat = Math.abs(us) < FLAT
    const lsFlat = Math.abs(ls) < FLAT
    const r2avg  = (uReg.r2 + lReg.r2) / 2

    // Converging? Gap narrows from start to end
    const gapStart = (us * startI + ui) - (ls * startI + li)
    const gapEnd   = (us * endI   + ui) - (ls * endI   + li)
    const converging = gapEnd < gapStart * 0.8  // 20%+ narrowing

    let type, kind
    if (usFlat && !lsFlat && ls > 0 && converging) {
      type = 'Ascending Triangle';  kind = 'bull'
    } else if (lsFlat && !usFlat && us < 0 && converging) {
      type = 'Descending Triangle'; kind = 'bear'
    } else if (us < -FLAT && ls > FLAT && converging) {
      type = 'Symmetrical Triangle'; kind = 'neutral'
    } else if (us > FLAT && ls > FLAT && ls > us && converging) {
      type = 'Rising Wedge';  kind = 'bear'
    } else if (us < -FLAT && ls < -FLAT && Math.abs(us) > Math.abs(ls) && converging) {
      type = 'Falling Wedge'; kind = 'bull'
    } else if (usFlat && lsFlat && !converging) {
      const channelPct = (uAtMid - lAtMid) / uAtMid
      if (channelPct > 0.03 && channelPct < 0.12) {
        type = 'Rectangle'; kind = 'neutral'
      }
    }
    if (!type) return

    const score = Math.round(r2avg * 65 + (converging ? 25 : 15) + Math.max(0, 1 - (nb - 1 - endI) / 20) * 10)
    patterns.push({
      type, kind, score,
      startI, endI,
      upperSlope: us, upperInt: ui,
      lowerSlope: ls, lowerInt: li,
      labelI: Math.round((startI + endI) / 2), labelSide: kind === 'bull' ? 'bottom' : 'top',
    })
  })()

  // ── Bull / Bear Pennant ────────────────────────────────────────────────────
  ;(() => {
    // Look for a sharp pole (>5% in <10 bars), then small consolidating triangle
    const POLE_MIN_BARS = 4, POLE_MAX_BARS = 14
    const CONS_MIN = 5, CONS_MAX = 25
    for (let poleEnd = nb - CONS_MIN - 1; poleEnd >= POLE_MIN_BARS; poleEnd--) {
      for (let poleStart = Math.max(0, poleEnd - POLE_MAX_BARS); poleStart < poleEnd - POLE_MIN_BARS + 1; poleStart++) {
        const move = (c[poleEnd] - c[poleStart]) / c[poleStart]
        if (Math.abs(move) < 0.05) continue  // pole must be ≥5%
        const isBull = move > 0
        // Consolidation: from poleEnd+1 to nb-1
        const consStart = poleEnd + 1, consEnd = Math.min(nb - 1, consStart + CONS_MAX)
        const consLen   = consEnd - consStart
        if (consLen < CONS_MIN) continue
        const consH = h.slice(consStart, consEnd + 1)
        const consL = l.slice(consStart, consEnd + 1)
        const consRange = (Math.max(...consH) - Math.min(...consL)) / Math.abs(c[poleEnd])
        if (consRange > 0.08) continue  // consolidation must be tight

        // Consolidation should narrow (pennant shape)
        const firstHalf  = (Math.max(...consH.slice(0, Math.floor(consLen/2))) - Math.min(...consL.slice(0, Math.floor(consLen/2)))) / Math.abs(c[poleEnd])
        const secondHalf = (Math.max(...consH.slice(Math.floor(consLen/2)))    - Math.min(...consL.slice(Math.floor(consLen/2))))    / Math.abs(c[poleEnd])
        if (secondHalf >= firstHalf * 0.9) continue  // must narrow

        const score = Math.round(Math.min(Math.abs(move) / 0.12, 1) * 50 + (1 - consRange / 0.08) * 30 + Math.max(0, 1 - (nb - 1 - consEnd) / 15) * 20)
        patterns.push({
          type: isBull ? 'Bull Pennant' : 'Bear Pennant',
          kind: isBull ? 'bull' : 'bear',
          score,
          startI: poleStart, endI: consEnd, poleEnd,
          labelI: Math.round((poleEnd + consEnd) / 2),
          labelSide: isBull ? 'top' : 'bottom',
        })
        return
      }
    }
  })()

  // Filter: score ≥ 55, sort best first, cap at 5 visible patterns
  return patterns
    .filter(p => p.score >= 55)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
}
