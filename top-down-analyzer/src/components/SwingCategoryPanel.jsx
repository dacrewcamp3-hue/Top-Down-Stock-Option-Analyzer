import './SwingCategoryPanel.css'

const DIR_ICON = { bull: '↑', bear: '↓', neutral: '→' }

const PANEL_CLASS = {
  fourHSignal: 'swing-panel-4h',
  trendFilter: 'swing-panel-trend',
}

export default function SwingCategoryPanel({ cat, values, onFieldChange, collapsed, onToggleCollapse }) {
  const total = cat.fields.length
  const answeredCount = cat.fields.filter(f => {
    const v = values[f.id]
    return v !== null && v !== undefined
  }).length
  const isComplete = answeredCount === total && total > 0
  const progressState = answeredCount === 0 ? 'empty' : isComplete ? 'complete' : 'partial'
  const panelClass = PANEL_CLASS[cat.id] ?? ''

  return (
    <div className={`swing-panel ${panelClass}`}>
      <button className="swing-panel-header" onClick={onToggleCollapse} aria-expanded={!collapsed}>
        <span className="swing-badge">{cat.shortLabel}</span>
        <span className="swing-panel-label">{cat.label}</span>

        <div className="swing-header-right">
          <span className={`swing-progress-badge ${progressState}`}>
            {answeredCount}/{total}
          </span>
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
                  const icon = DIR_ICON[opt.direction] ?? ''

                  return (
                    <button
                      key={opt.id}
                      className={`swing-btn ${dirClass}`}
                      onClick={() => onFieldChange(field.id, isActive ? null : opt.id)}
                    >
                      <span className="swing-btn-icon">{icon}</span>
                      <span className="swing-btn-text">{opt.label}</span>
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
