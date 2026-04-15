import { useCallback, useEffect, useRef, useState } from 'react';
import { postSettingsMessage, useSettings } from '../../context/SettingsContext';

function numOrUndef(val: string): number | undefined {
  const n = Number(val);
  return isNaN(n) || val === '' ? undefined : n;
}

export function LoggingSection() {
  const { state, dispatch } = useSettings();
  const logging = state.config.logging ?? {};
  const logLevel = logging.level ?? state.config.logLevel ?? '';
  const retentionDays = logging.retentionDays ?? 7;

  const [selectedFile, setSelectedFile] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState('');
  const consoleRef = useRef<HTMLPreElement>(null);

  // Request log files list when section mounts
  useEffect(() => {
    postSettingsMessage({ type: 'requestLogFiles' });
    postSettingsMessage({ type: 'requestLogs' });
  }, []);

  // Auto-scroll to bottom when new content arrives
  useEffect(() => {
    if (autoScroll && consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [state.logContent, autoScroll]);

  function update(patch: Record<string, unknown>) {
    dispatch({ type: 'updateConfig', patch: { logging: { ...logging, ...patch } } });
  }

  const handleLevelChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value || undefined;
    update({ level: val });
  }, [logging]);

  const handleRefresh = useCallback(() => {
    if (selectedFile) {
      postSettingsMessage({ type: 'requestLogs', fileName: selectedFile });
    } else {
      postSettingsMessage({ type: 'requestLogs' });
    }
    postSettingsMessage({ type: 'requestLogFiles' });
  }, [selectedFile]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const file = e.target.value;
    setSelectedFile(file);
    if (file) {
      postSettingsMessage({ type: 'requestLogs', fileName: file });
    } else {
      postSettingsMessage({ type: 'requestLogs' });
    }
  }, []);

  const handleCopy = useCallback(() => {
    const text = filteredContent();
    void navigator.clipboard.writeText(text);
  }, [state.logContent, filter]);

  function filteredContent(): string {
    if (!filter) { return state.logContent; }
    const lower = filter.toLowerCase();
    return state.logContent
      .split('\n')
      .filter(line => line.toLowerCase().includes(lower))
      .join('\n');
  }

  const displayContent = filteredContent();

  return (
    <div className="section section--logging">
      <div className="section__title">Logging</div>

      <div className="cols-2">
        <div className="field">
          <label htmlFor="log-level-sel">Log level</label>
          <select
            id="log-level-sel"
            value={logLevel}
            onChange={handleLevelChange}
          >
            <option value="">Default (info)</option>
            <option value="trace">Trace</option>
            <option value="debug">Debug</option>
            <option value="info">Info</option>
            <option value="warn">Warn</option>
            <option value="error">Error</option>
          </select>
          <span className="hint">Minimum severity written to output channel and log file.</span>
        </div>
        <div className="field">
          <label htmlFor="retention-days">Retention (days)</label>
          <input
            type="number"
            id="retention-days"
            min={1}
            max={90}
            value={retentionDays}
            onChange={e => update({ retentionDays: numOrUndef(e.target.value) })}
          />
          <span className="hint">How many days of log files to keep before auto-cleanup.</span>
        </div>
      </div>

      <div className="log-console-header">
        <div className="log-console-header__left">
          <select
            className="log-file-select"
            value={selectedFile}
            onChange={handleFileChange}
          >
            <option value="">Today</option>
            {state.logFiles.map(f => (
              <option key={f} value={f}>{f.replace('agent-board-', '').replace('.log', '')}</option>
            ))}
          </select>
          <input
            type="text"
            className="log-filter-input"
            placeholder="Filter…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
        </div>
        <div className="log-console-header__right">
          <label className="log-auto-scroll">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={e => setAutoScroll(e.target.checked)}
            />
            Auto-scroll
          </label>
          <button className="btn btn--secondary btn--sm" onClick={handleRefresh}>⟳ Refresh</button>
          <button className="btn btn--secondary btn--sm" onClick={handleCopy}>📋 Copy</button>
        </div>
      </div>

      <pre className="log-console" ref={consoleRef}>
        {displayContent || '(no log entries)'}
      </pre>
    </div>
  );
}
