import Tooltip from './Tooltip'
import { GLOSSARY } from '../data/glossary'
import './TimeframePanel.css'

export default function TimeframePanel({ tf, values, onFieldChange, collapsed, onToggleCollapse }) {
  const bullCount = Object.values(values).filter(v => v === 'bull').length
  const bearCount = Object.values(values).filter(v => v === 'bear').length
  const total = bullCount + bearCount
  const bullPct = total === 0 ? 50 : (bullCount / total) * 100

  return (
    <div className="tf-panel">
      <button className="tf-panel-header" onClick={onToggleCollapse} aria-expanded={!collapsed}>
        <span className="tf-badge">{tf.shortLabel}</span>
        <span className="tf-label">{tf.label}</span>
        <span className="tf-weight">wt {tf.weight}</span>

        <div className="tf-mini-score">
          {bullCount > 0 && (
            <span className="tf-mini-count bull">{bullCount}▲</span>
          )}
          {bearCount > 0 && (
            <span className="tf-mini-count bear">{bearCount}▼</span>
          )}
          {total > 0 && (
            <div className="tf-score-bar" title={`${bullCount} bull / ${bearCount} bear`}>
              <div
                className="tf-score-fill bear-fill"
                style={{ width: `${100 - bullPct}%`, left: 0 }}
              />
              <div
                className="tf-score-fill bull-fill"
                style={{ width: `${bullPct}%`, right: 0 }}
              />
            </div>
          )}
        </div>

        <span className="tf-chevron" aria-hidden>
          {collapsed ? '▼' : '▲'}
        </span>
      </button>

      {!collapsed && (
        <div className="tf-panel-body">
          <div className="fields-grid">
            {tf.fields.map(field => (
              <div key={field.id} className="field-group">
                <span className="field-label">
                  {GLOSSARY[field.id]
                    ? <Tooltip text={GLOSSARY[field.id]}>{field.label}</Tooltip>
                    : field.label}
                </span>
                <div className="field-options">
                  {field.options.map(opt => {
                    const isActive = values[field.id] === opt.value
                    return (
                      <button
                        key={opt.value}
                        className={`field-btn ${isActive ? `active-${opt.value}` : ''}`}
                        onClick={() => onFieldChange(
                          field.id,
                          isActive ? null : opt.value
                        )}
                      >
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
