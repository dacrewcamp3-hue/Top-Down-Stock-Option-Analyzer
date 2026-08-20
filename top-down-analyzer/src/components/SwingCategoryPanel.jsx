import './SwingCategoryPanel.css'

export default function SwingCategoryPanel({ cat, values, onFieldChange, collapsed, onToggleCollapse }) {
  const answeredCount = cat.fields.filter(f => {
    const v = values[f.id]
    return v !== null && v !== undefined
  }).length
  const isComplete = answeredCount === cat.fields.length && cat.fields.length > 0

  return (
    <div className="swing-panel">
      <button className="swing-panel-header" onClick={onToggleCollapse} aria-expanded={!collapsed}>
        <span className="swing-badge">{cat.shortLabel}</span>
        <span className="swing-panel-label">{cat.label}</span>

        <div className="swing-header-right">
          {answeredCount > 0 && (
            <span className={`swing-complete-dot ${isComplete ? 'complete' : 'partial'}`} />
          )}
          <span className="swing-chevron" aria-hidden>{collapsed ? '▼' : '▲'}</span>
        </div>
      </button>

      {!collapsed && (
        <div className="swing-panel-body">
          {cat.fields.map(field => (
            <div key={field.id} className="swing-field-group">
              <span className="swing-field-label">{field.label}</span>
              <div className="swing-field-options">
                {field.options.map(opt => {
                  const isActive = values[field.id] === opt.id
                  const dirClass = isActive ? `active-${opt.direction ?? 'neutral'}` : ''

                  return (
                    <button
                      key={opt.id}
                      className={`swing-btn ${dirClass}`}
                      onClick={() => onFieldChange(field.id, isActive ? null : opt.id)}
                    >
                      {opt.label}
                      {opt.sub && <span className="swing-btn-sub">{opt.sub}</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
