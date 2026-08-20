
// Renders shimmer placeholder rows while data is loading.
// count: number of rows | height: px of each row | gap: px between rows
export function SkeletonRows({ count = 4, height = 14, gap = 10, width = '100%' }) {
  return (
    <div className="sk-rows" style={{ gap }}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="sk-bar"
          style={{
            height,
            width: typeof width === 'string' ? width : `${width}%`,
            // stagger widths so it looks organic, not grid-like
            maxWidth: i % 3 === 2 ? '60%' : i % 3 === 1 ? '80%' : '100%',
          }}
        />
      ))}
    </div>
  )
}

// Full card skeleton
export function SkeletonCard({ rows = 5, title = true }) {
  return (
    <div className="sk-card">
      {title && <div className="sk-bar sk-title" />}
      <SkeletonRows count={rows} />
    </div>
  )
}

// Inline spinner (small, for inside buttons / status lines)
export function Spinner({ size = 14, color = '#3a6090' }) {
  return (
    <span
      className="sk-spinner"
      style={{ width: size, height: size, borderTopColor: color }}
    />
  )
}
