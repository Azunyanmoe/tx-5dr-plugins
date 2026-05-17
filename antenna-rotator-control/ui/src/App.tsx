import React from 'react';
import { t } from '../shared/i18n';
import { invokePlugin } from './bridge';
import {
  angularDistance,
  applyNetworkModel,
  applyTheme,
  findSelectedModel,
  formatAngle,
  formatTime,
  getControlViewModel,
  isWithinSoftLimits,
  projectSmoothDegrees,
  parseKeyValues,
  resizeHost,
  serializeKeyValues,
} from './rotator-ui-utils';
import type { Banner, BootstrapResponse, RotatorConfig, RotatorPreset, RotatorStateSnapshot, SupportedRotatorInfo, TabId } from './types';

interface ConfirmState {
  message: string;
  resolve: (confirmed: boolean) => void;
}

function useHostResize(dependencies: React.DependencyList): void {
  React.useLayoutEffect(() => {
    resizeHost();
  }, dependencies);
}

function ConfirmDialog({ state }: { state: ConfirmState | null }) {
  React.useEffect(() => {
    if (!state) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        state.resolve(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [state]);

  if (!state) {
    return null;
  }

  return (
    <div className="confirm-backdrop" onClick={(event) => event.target === event.currentTarget && state.resolve(false)}>
      <div className="confirm-card" role="dialog" aria-modal="true">
        <div className="confirm-message">{state.message}</div>
        <div className="confirm-actions">
          <button type="button" onClick={() => state.resolve(false)}>{t('cancel')}</button>
          <button type="button" className="primary" autoFocus onClick={() => state.resolve(true)}>{t('confirm')}</button>
        </div>
      </div>
    </div>
  );
}

function Shell({
  activeTab,
  banner,
  pending,
  state,
  onChangeTab,
  onToggleConnection,
  children,
}: {
  activeTab: TabId;
  banner: Banner;
  pending: boolean;
  state: RotatorStateSnapshot | null;
  onChangeTab: (tab: TabId) => void;
  onToggleConnection: () => void;
  children: React.ReactNode;
}) {
  const status = state?.status ?? 'disconnected';
  const shouldConnect = status === 'disconnected' || status === 'error';

  return (
    <main className="rotator-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">TX-5DR / Hamlib</div>
          <h1>{t('rotatorTitle')}</h1>
        </div>
        <div className="connection-cluster">
          <span className={`status-pill status-${status}`}>{t(`status.${status}`)}</span>
          <button
            type="button"
            className={`connection-button ${shouldConnect ? 'primary' : ''}`}
            disabled={pending || !state}
            onClick={onToggleConnection}
          >
            {shouldConnect ? t('connect') : t('disconnect')}
          </button>
        </div>
      </header>
      <nav className="tabs">
        {(['control', 'setup', 'diagnostics'] as const).map((tab) => (
          <button key={tab} type="button" className={`tab ${activeTab === tab ? 'active' : ''}`} onClick={() => onChangeTab(tab)}>
            {t(`tab.${tab}`)}
          </button>
        ))}
      </nav>
      {banner && <div className={`banner ${banner.type}`}>{banner.message}</div>}
      {children}
    </main>
  );
}

function ControlTab({
  state,
  pending,
  onSetAzimuth,
  onStop,
  onPark,
}: {
  state: RotatorStateSnapshot;
  pending: boolean;
  onSetAzimuth: (target: number) => void;
  onStop: () => void;
  onPark: () => void;
}) {
  const view = getControlViewModel(state);
  const [smoothCurrentAngle, setSmoothCurrentAngle] = React.useState(() => projectSmoothDegrees(undefined, view.currentAngle));
  const [smoothTargetAngle, setSmoothTargetAngle] = React.useState(() => projectSmoothDegrees(undefined, view.targetAngle));
  const autoTarget = Number.isFinite(view.targetAngle) ? Number(view.targetAngle).toFixed(1) : '';
  const [targetInput, setTargetInput] = React.useState(autoTarget);
  const [isEditingTarget, setIsEditingTarget] = React.useState(false);
  const [isDirtyTarget, setIsDirtyTarget] = React.useState(false);

  React.useEffect(() => {
    setSmoothCurrentAngle((previous) => projectSmoothDegrees(previous, view.currentAngle));
  }, [view.currentAngle]);

  React.useEffect(() => {
    setSmoothTargetAngle((previous) => projectSmoothDegrees(previous, view.targetAngle));
  }, [view.targetAngle]);

  React.useEffect(() => {
    if (!isEditingTarget && !isDirtyTarget) {
      setTargetInput(autoTarget);
    }
  }, [autoTarget, isDirtyTarget, isEditingTarget]);

  const setTargetDraft = (target: number) => {
    setIsDirtyTarget(false);
    setIsEditingTarget(false);
    setTargetInput(Number.isFinite(target) ? String(target) : '');
  };
  const submitTarget = (target: number) => {
    setTargetDraft(target);
    onSetAzimuth(target);
  };
  const nudgeTarget = (step: number) => {
    const base = Number(targetInput);
    const fallback = state.movement?.targetAzimuth ?? state.lastCommandedAzimuth ?? state.position?.azimuth ?? Number.NaN;
    const next = (Number.isFinite(base) ? base : fallback) + step;
    setTargetDraft(next);
    onSetAzimuth(next);
  };

  return (
    <section className="control-grid">
      <div className="compass-card">
        <div className="compass" style={{ '--az': smoothCurrentAngle, '--target': smoothTargetAngle } as React.CSSProperties}>
          <div className="ring" />
          <div className="needle current" />
          <div className="needle target" />
          <div className="compass-center">
            <strong>{view.centerValue}</strong>
            <span>{view.centerLabel}</span>
          </div>
          <span className="cardinal n">N</span>
          <span className="cardinal e">E</span>
          <span className="cardinal s">S</span>
          <span className="cardinal w">W</span>
        </div>
        <div className="meta-row">
          <span>{view.updated}</span>
          <span>{view.softLimits}</span>
        </div>
      </div>
      <div className="command-card">
        <label className="field-label" htmlFor="targetAzimuth">{t('targetAzimuth')}</label>
        <div className="angle-row">
          <input
            id="targetAzimuth"
            type="number"
            step="1"
            value={targetInput}
            placeholder={t('azimuthPlaceholder')}
            onFocus={() => setIsEditingTarget(true)}
            onBlur={() => setIsEditingTarget(false)}
            onChange={(event) => {
              setTargetInput(event.target.value);
              setIsDirtyTarget(true);
            }}
          />
          <button type="button" className="primary" disabled={pending} onClick={() => submitTarget(Number(targetInput))}>{t('apply')}</button>
        </div>
        <div className="step-grid">
          {[-10, -1, 1, 10].map((step) => (
            <button key={step} type="button" disabled={pending} onClick={() => nudgeTarget(step)}>
              {step > 0 ? '+' : ''}{step}
            </button>
          ))}
        </div>
        <div className="preset-grid">
          {state.config.presets.map((preset) => (
            <button key={`${preset.label}:${preset.azimuth}`} type="button" disabled={pending} onClick={() => submitTarget(preset.azimuth)}>
              {preset.label} <span>{formatAngle(preset.azimuth)}</span>
            </button>
          ))}
        </div>
        <div className="safety-note">{t('noElevation')}</div>
        <div className="action-row control-actions">
          <button type="button" disabled={pending} onClick={onPark}>{t('park')}</button>
          <button type="button" className="stop" onClick={onStop}>{t('stop')}</button>
        </div>
      </div>
    </section>
  );
}

function SetupTab({
  state,
  supportedRotators,
  pending,
  onListRotators,
  onSaveConfig,
  onTestConnection,
}: {
  state: RotatorStateSnapshot;
  supportedRotators: SupportedRotatorInfo[];
  pending: boolean;
  onListRotators: () => Promise<void>;
  onSaveConfig: (config: RotatorConfig) => Promise<void>;
  onTestConnection: (config: RotatorConfig) => Promise<void>;
}) {
  const config = state.config;
  const configSignature = React.useMemo(() => JSON.stringify(config), [config]);
  const lastSyncedConfigSignatureRef = React.useRef(configSignature);
  const [isDirty, setIsDirty] = React.useState(false);
  const [connectionMode, setConnectionMode] = React.useState(config.connectionMode);
  const [networkAddress, setNetworkAddress] = React.useState(config.networkAddress);
  const [serialPort, setSerialPort] = React.useState(config.serialPort);
  const [rotModel, setRotModel] = React.useState(String(config.rotModel));
  const [modelSearch, setModelSearch] = React.useState('');
  const [softMinAz, setSoftMinAz] = React.useState(String(config.softMinAz));
  const [softMaxAz, setSoftMaxAz] = React.useState(String(config.softMaxAz));
  const [homeAzimuth, setHomeAzimuth] = React.useState(String(config.homeAzimuth));
  const [northOffsetDeg, setNorthOffsetDeg] = React.useState(String((config as RotatorConfig & { northOffsetDeg?: number }).northOffsetDeg ?? 0));
  const [pollIntervalMs, setPollIntervalMs] = React.useState(String(config.pollIntervalMs));
  const [movementTimeoutMs, setMovementTimeoutMs] = React.useState(String(config.movementTimeoutMs));
  const [largeStepThresholdDeg, setLargeStepThresholdDeg] = React.useState(String(config.largeStepThresholdDeg));
  const [confText, setConfText] = React.useState(serializeKeyValues(config.conf));
  const [presets, setPresets] = React.useState<RotatorPreset[]>(config.presets);

  const syncFromConfig = React.useCallback((nextConfig: RotatorConfig) => {
    setConnectionMode(nextConfig.connectionMode);
    setNetworkAddress(nextConfig.networkAddress);
    setSerialPort(nextConfig.serialPort);
    setRotModel(String(nextConfig.rotModel));
    setSoftMinAz(String(nextConfig.softMinAz));
    setSoftMaxAz(String(nextConfig.softMaxAz));
    setHomeAzimuth(String(nextConfig.homeAzimuth));
    setNorthOffsetDeg(String((nextConfig as RotatorConfig & { northOffsetDeg?: number }).northOffsetDeg ?? 0));
    setPollIntervalMs(String(nextConfig.pollIntervalMs));
    setMovementTimeoutMs(String(nextConfig.movementTimeoutMs));
    setLargeStepThresholdDeg(String(nextConfig.largeStepThresholdDeg));
    setConfText(serializeKeyValues(nextConfig.conf));
    setPresets(nextConfig.presets);
  }, []);

  React.useEffect(() => {
    if (configSignature === lastSyncedConfigSignatureRef.current) {
      return;
    }
    if (isDirty) {
      return;
    }
    syncFromConfig(config);
    lastSyncedConfigSignatureRef.current = configSignature;
  }, [config, configSignature, isDirty, syncFromConfig]);

  const markDirty = () => setIsDirty(true);
  const markSynced = (nextConfig: RotatorConfig) => {
    syncFromConfig(nextConfig);
    lastSyncedConfigSignatureRef.current = JSON.stringify(nextConfig);
    setIsDirty(false);
  };

  const filtered = supportedRotators.filter((entry) => {
    const text = `${entry.modelName} ${entry.mfgName} ${entry.rotModel}`.toLowerCase();
    return !modelSearch || text.includes(modelSearch.toLowerCase());
  }).slice(0, 200);

  const buildDraftConfig = () => {
    const selectedModel = Number(rotModel);
    const selected = findSelectedModel(supportedRotators, selectedModel);
    return applyNetworkModel({
      ...config,
      connectionMode,
      rotModel: Number.isFinite(selectedModel) ? selectedModel : config.rotModel,
      modelName: selected?.modelName ?? config.modelName,
      serialPort,
      networkAddress,
      conf: parseKeyValues(confText),
      softMinAz: Number(softMinAz),
      softMaxAz: Number(softMaxAz),
      homeAzimuth: Number(homeAzimuth),
      northOffsetDeg: Number(northOffsetDeg),
      pollIntervalMs: Number(pollIntervalMs),
      movementTimeoutMs: Number(movementTimeoutMs),
      largeStepThresholdDeg: Number(largeStepThresholdDeg),
      presets,
    });
  };

  const buildConnectionConfig = buildDraftConfig;
  const buildSafetyConfig = buildDraftConfig;

  return (
    <section className="form-grid">
      <div className="form-card">
        <div className="card-header"><h2>{t('connectionMode')}</h2></div>
        <div className="segmented">
          <label><input type="radio" name="mode" value="network" checked={connectionMode === 'network'} onChange={() => { markDirty(); setConnectionMode('network'); }} /> {t('network')}</label>
          <label><input type="radio" name="mode" value="serial" checked={connectionMode === 'serial'} onChange={() => { markDirty(); setConnectionMode('serial'); }} /> {t('serial')}</label>
        </div>
        {connectionMode === 'network' ? (
          <div className="mode-field">
            <label htmlFor="networkAddress">{t('networkAddress')}</label>
            <input id="networkAddress" value={networkAddress} placeholder={t('networkPlaceholder')} onChange={(event) => { markDirty(); setNetworkAddress(event.target.value); }} />
            <div className="backend-note">{t('networkBackend')}</div>
          </div>
        ) : (
          <>
            <div className="mode-field">
              <label htmlFor="serialPort">{t('serialPort')}</label>
              <input id="serialPort" value={serialPort} placeholder={t('serialPortPlaceholder')} onChange={(event) => { markDirty(); setSerialPort(event.target.value); }} />
            </div>
            <div className="model-section">
              <div className="field-heading">
                <label htmlFor="modelSearch">{t('rotatorModel')}</label>
                <button className="icon-button" type="button" title={t('refreshRotators')} aria-label={t('refreshRotators')} disabled={pending} onClick={() => void onListRotators()}>&#8635;</button>
              </div>
              <input id="modelSearch" value={modelSearch} placeholder={t('modelSearchPlaceholder')} onChange={(event) => setModelSearch(event.target.value)} />
              <select id="rotModel" size={7} value={rotModel} onChange={(event) => { markDirty(); setRotModel(event.target.value); }}>
                {filtered.map((entry) => (
                  <option key={entry.rotModel} value={entry.rotModel}>{entry.mfgName} / {entry.modelName} (#{entry.rotModel})</option>
                ))}
              </select>
              {filtered.length === 0 && <div className="hint">{t('emptyRotators')}</div>}
            </div>
          </>
        )}
        <div className="card-footer">
          <button type="button" disabled={pending} onClick={() => void onTestConnection(buildConnectionConfig())}>{t('testConnection')}</button>
          <button type="button" className="primary" disabled={pending} onClick={() => { const nextConfig = buildConnectionConfig(); markSynced(nextConfig); void onSaveConfig(nextConfig); }}>{t('save')}</button>
        </div>
      </div>
      <div className="form-card">
        <div className="card-header"><h2>{t('safety')}</h2></div>
        <div className="two-col safety-grid">
          <label>{t('softMinAz')}<input type="number" value={softMinAz} onChange={(event) => { markDirty(); setSoftMinAz(event.target.value); }} /></label>
          <label>{t('softMaxAz')}<input type="number" value={softMaxAz} onChange={(event) => { markDirty(); setSoftMaxAz(event.target.value); }} /></label>
          <label>{t('homeAzimuth')}<input type="number" value={homeAzimuth} onChange={(event) => { markDirty(); setHomeAzimuth(event.target.value); }} /></label>
          <label>{t('northOffsetDeg')}<input type="number" value={northOffsetDeg} onChange={(event) => { markDirty(); setNorthOffsetDeg(event.target.value); }} /></label>
          <label>{t('pollIntervalMs')}<input type="number" value={pollIntervalMs} onChange={(event) => { markDirty(); setPollIntervalMs(event.target.value); }} /></label>
          <label>{t('movementTimeoutMs')}<input type="number" value={movementTimeoutMs} onChange={(event) => { markDirty(); setMovementTimeoutMs(event.target.value); }} /></label>
          <label>{t('largeStepThresholdDeg')}<input type="number" value={largeStepThresholdDeg} onChange={(event) => { markDirty(); setLargeStepThresholdDeg(event.target.value); }} /></label>
        </div>
        <label>{t('advancedConfig')}</label>
        <textarea rows={4} spellCheck={false} value={confText} onChange={(event) => { markDirty(); setConfText(event.target.value); }} />
        <p className="hint">{t('advancedConfigHint')}</p>
        <div className="card-footer">
          <button type="button" className="primary" disabled={pending} onClick={() => { const nextConfig = buildSafetyConfig(); markSynced(nextConfig); void onSaveConfig(nextConfig); }}>{t('save')}</button>
        </div>
      </div>
      <div className="form-card presets-card">
        <div className="card-header">
          <h2>{t('presets')}</h2>
          <button
            type="button"
            className="small-button"
            disabled={pending || presets.length >= 24}
            onClick={() => {
              markDirty();
              setPresets([...presets, { label: `P${presets.length + 1}`, azimuth: 0 }]);
            }}
          >
            {t('addPreset')}
          </button>
        </div>
        <div className="preset-editor-list">
          {presets.length === 0 ? (
            <div className="hint">{t('emptyPresets')}</div>
          ) : presets.map((preset, index) => (
            <div className="preset-editor-row" key={`${index}:${preset.label}:${preset.azimuth}`}>
              <label>
                {t('presetLabel')}
                <input
                  value={preset.label}
                  maxLength={24}
                  onChange={(event) => {
                    markDirty();
                    const next = [...presets];
                    next[index] = { ...preset, label: event.target.value };
                    setPresets(next);
                  }}
                />
              </label>
              <label>
                {t('presetAzimuth')}
                <input
                  type="number"
                  value={String(preset.azimuth)}
                  onChange={(event) => {
                    markDirty();
                    const parsed = Number(event.target.value);
                    const next = [...presets];
                    next[index] = { ...preset, azimuth: Number.isFinite(parsed) ? parsed : 0 };
                    setPresets(next);
                  }}
                />
              </label>
              <button
                type="button"
                className="danger-lite icon-button"
                aria-label={t('delete')}
                title={t('delete')}
                disabled={pending}
                onClick={() => {
                  markDirty();
                  setPresets(presets.filter((_, presetIndex) => presetIndex !== index));
                }}
              >
                <svg className="trash-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M8.6 3.5h6.8l.7 1.8H20v2H4v-2h3.9l.7-1.8Z" />
                  <path d="M6.2 8.8h11.6l-.7 10.5a2.2 2.2 0 0 1-2.2 2.1H9.1a2.2 2.2 0 0 1-2.2-2.1L6.2 8.8Zm3.3 2.1.35 7.6h1.5L11 10.9H9.5Zm3.15 0v7.6h1.5v-7.6h-1.5Z" />
                </svg>
              </button>
            </div>
          ))}
        </div>
        <p className="hint">{t('presetsHint')}</p>
        <div className="card-footer">
          <button type="button" className="primary" disabled={pending} onClick={() => { const nextConfig = buildDraftConfig(); markSynced(nextConfig); void onSaveConfig(nextConfig); }}>{t('save')}</button>
        </div>
      </div>
    </section>
  );
}

function DiagnosticsTab({ state, copied, onCopy }: { state: RotatorStateSnapshot; copied: boolean; onCopy: (diagnostics: string) => void }) {
  const diagnostics = JSON.stringify(state, null, 2);
  const renderJsonDetail = (title: string, value: unknown) => (
    <details>
      <summary>{title}</summary>
      <pre className="json-block">{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</pre>
    </details>
  );

  return (
    <section className="diagnostics">
      <div className="diagnostic-summary">
        <div><span>Hamlib</span><strong>{state.hamlibVersion ?? '--'}</strong></div>
        <div><span>{t('statusFlags')}</span><strong>{state.statusFlags.join(', ') || '--'}</strong></div>
        <div><span>{t('lastCommanded')}</span><strong>{formatAngle(state.lastCommandedAzimuth)}</strong></div>
      </div>
      <button type="button" onClick={() => onCopy(diagnostics)}>{copied ? t('copied') : t('copyDiagnostics')}</button>
      <details open>
        <summary>{t('logs')}</summary>
        <div className="log-list">
          {state.logs.map((entry, index) => (
            <div key={`${entry.timestamp}:${index}`} className={`log-entry ${entry.level}`}>
              <time>{formatTime(entry.timestamp)}</time>
              <span>{t(entry.message, entry.message)}</span>
              <small>{entry.detail ?? ''}</small>
            </div>
          ))}
        </div>
      </details>
      {renderJsonDetail(t('hardwareInfo'), state.hardwareInfo || '--')}
      {renderJsonDetail(t('caps'), state.caps)}
      {renderJsonDetail(t('portCaps'), state.portCaps)}
      {renderJsonDetail(t('configSchema'), state.configSchema)}
      <pre className="json-block">{diagnostics}</pre>
    </section>
  );
}

export function App() {
  const [activeTab, setActiveTab] = React.useState<TabId>('control');
  const [state, setState] = React.useState<RotatorStateSnapshot | null>(null);
  const [supportedRotators, setSupportedRotators] = React.useState<SupportedRotatorInfo[]>([]);
  const [pending, setPending] = React.useState(false);
  const [banner, setBanner] = React.useState<Banner>(null);
  const [copied, setCopied] = React.useState(false);
  const [confirmState, setConfirmState] = React.useState<ConfirmState | null>(null);
  const [localeVersion, setLocaleVersion] = React.useState(0);
  const firstMoveConfirmedRef = React.useRef(false);

  useHostResize([activeTab, state, banner, confirmState, copied, localeVersion]);

  const confirmAction = React.useCallback((message: string) => new Promise<boolean>((resolve) => {
    setConfirmState({
      message,
      resolve: (confirmed) => {
        setConfirmState(null);
        resolve(confirmed);
      },
    });
  }), []);

  const runInvoke = React.useCallback(async <T,>(action: string, data?: unknown): Promise<T> => {
    setPending(true);
    setBanner(null);
    try {
      return await invokePlugin<T>(action, data);
    } catch (error) {
      setBanner({ type: 'error', message: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      setPending(false);
    }
  }, []);

  const refreshBootstrap = React.useCallback(async () => {
    const response = await runInvoke<BootstrapResponse>('getBootstrap');
    setState(response.state);
    setSupportedRotators(response.supportedRotators);
  }, [runInvoke]);

  const mutateState = React.useCallback(async (action: string, data?: unknown) => {
    const next = await runInvoke<RotatorStateSnapshot>(action, data);
    setState(next);
  }, [runInvoke]);

  React.useEffect(() => {
    const pushOff = window.tx5dr.onPush('stateUpdated', (nextState: RotatorStateSnapshot) => setState(nextState));
    const themeOff = window.tx5dr.onThemeChange((theme) => applyTheme(theme));
    const localeOff = window.tx5dr.onLocaleChange(() => setLocaleVersion((version) => version + 1));
    const onResize = () => resizeHost();
    window.addEventListener('resize', onResize);

    void window.tx5dr.ready.then((bridgeState) => {
      applyTheme(bridgeState.theme);
      return refreshBootstrap();
    }).catch((error) => {
      setBanner({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    });

    return () => {
      if (typeof pushOff === 'function') pushOff();
      if (typeof themeOff === 'function') themeOff();
      if (typeof localeOff === 'function') localeOff();
      window.removeEventListener('resize', onResize);
    };
  }, [refreshBootstrap]);

  const handleToggleConnection = React.useCallback(() => {
    if (!state) {
      return;
    }
    const action = state.status === 'disconnected' || state.status === 'error' ? 'connect' : 'disconnect';
    void mutateState(action).catch(() => undefined);
  }, [mutateState, state]);

  const handleSetAzimuth = React.useCallback(async (target: number) => {
    if (!state) {
      return;
    }
    if (!Number.isFinite(target)) {
      setBanner({ type: 'error', message: t('unknownPosition') });
      return;
    }
    if (state.status !== 'connected' && state.status !== 'moving') {
      setBanner({ type: 'error', message: t('notConnected') });
      return;
    }
    if (!isWithinSoftLimits(target, state.config.softMinAz, state.config.softMaxAz)) {
      setBanner({ type: 'error', message: t('outOfLimit') });
      return;
    }
    const current = state.position?.azimuth ?? state.lastCommandedAzimuth ?? undefined;
    if (!firstMoveConfirmedRef.current && !(await confirmAction(t('firstMoveConfirm')))) {
      return;
    }
    firstMoveConfirmedRef.current = true;
    if (state.position?.stale && !(await confirmAction(t('staleConfirm')))) {
      return;
    }
    if (current !== undefined && angularDistance(current, target) > state.config.largeStepThresholdDeg && !(await confirmAction(t('largeStepConfirm')))) {
      return;
    }
    void mutateState('setAzimuth', { azimuth: target }).catch(() => undefined);
  }, [confirmAction, mutateState, state]);

  const handleSaveConfig = React.useCallback(async (config: RotatorConfig) => {
    const next = await runInvoke<RotatorStateSnapshot>('saveConfig', { config });
    setState(next);
    setBanner({ type: 'info', message: t('config_saved') });
  }, [runInvoke]);

  const handleTestConnection = React.useCallback(async (config: RotatorConfig) => {
    const next = await runInvoke<RotatorStateSnapshot>('testConnection', { config });
    setState(next);
    setBanner({ type: 'info', message: t('test_connection_ok') });
  }, [runInvoke]);

  const content = !state
    ? <section className="loading">Loading...</section>
    : activeTab === 'setup'
      ? (
        <SetupTab
          state={state}
          supportedRotators={supportedRotators}
          pending={pending}
          onListRotators={async () => setSupportedRotators(await runInvoke<SupportedRotatorInfo[]>('listRotators'))}
          onSaveConfig={handleSaveConfig}
          onTestConnection={handleTestConnection}
        />
      )
      : activeTab === 'diagnostics'
        ? (
          <DiagnosticsTab
            state={state}
            copied={copied}
            onCopy={(diagnostics) => {
              void navigator.clipboard.writeText(diagnostics);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            }}
          />
        )
        : (
          <ControlTab
            state={state}
            pending={pending}
            onSetAzimuth={(target) => void handleSetAzimuth(target)}
            onStop={() => void mutateState('stop').catch(() => undefined)}
            onPark={() => void confirmAction(t('parkConfirm')).then((ok) => ok && mutateState('park').catch(() => undefined))}
          />
        );

  return (
    <>
      <Shell
        activeTab={activeTab}
        banner={banner}
        pending={pending}
        state={state}
        onChangeTab={(tab) => {
          setActiveTab(tab);
          setBanner(null);
        }}
        onToggleConnection={handleToggleConnection}
      >
        {content}
      </Shell>
      <ConfirmDialog state={confirmState} />
    </>
  );
}
