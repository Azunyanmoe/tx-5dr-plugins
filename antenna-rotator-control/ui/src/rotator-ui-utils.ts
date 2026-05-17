import { t } from '../shared/i18n';
import type { RotatorConfig, RotatorStateSnapshot, SupportedRotatorInfo } from './types';

export const NETWORK_ROTCTL_MODEL = 2;
export const NETWORK_ROTCTL_MODEL_NAME = 'NET rotctl';

export function applyTheme(theme: 'dark' | 'light'): void {
  document.documentElement.dataset.tx5drTheme = theme;
  document.documentElement.style.colorScheme = theme;
  document.body.dataset.tx5drTheme = theme;
}

export function resizeHost(): void {
  window.tx5dr?.resize(Math.max(420, document.body.scrollHeight));
}

export function parseKeyValues(raw: string): Record<string, string> {
  const entries = raw.split('\n').flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return [];
    }
    const split = trimmed.indexOf('=');
    if (split < 0) {
      return [];
    }
    const key = trimmed.slice(0, split).trim();
    const value = trimmed.slice(split + 1).trim();
    return key ? [[key, value] as const] : [];
  });
  return Object.fromEntries(entries);
}

export function serializeKeyValues(values: Record<string, string>): string {
  return Object.entries(values ?? {}).map(([key, value]) => `${key}=${value}`).join('\n');
}


export function applyNetworkModel(config: RotatorConfig): RotatorConfig {
  if (config.connectionMode !== 'network') {
    return config;
  }
  return {
    ...config,
    rotModel: NETWORK_ROTCTL_MODEL,
    modelName: NETWORK_ROTCTL_MODEL_NAME,
  };
}


export function normalizeDegrees(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

export function projectSmoothDegrees(previous: number | undefined, next: number): number {
  const normalizedNext = normalizeDegrees(next);
  if (previous === undefined || !Number.isFinite(previous)) {
    return normalizedNext;
  }
  const previousNormalized = normalizeDegrees(previous);
  let delta = normalizedNext - previousNormalized;
  if (delta > 180) {
    delta -= 360;
  } else if (delta < -180) {
    delta += 360;
  }
  return previous + delta;
}

export function isWithinSoftLimits(azimuth: number, minAz: number, maxAz: number): boolean {
  if (minAz <= maxAz) {
    return azimuth >= minAz && azimuth <= maxAz;
  }
  return azimuth >= minAz || azimuth <= maxAz;
}

export function angularDistance(a: number, b: number): number {
  const left = ((a % 360) + 360) % 360;
  const right = ((b % 360) + 360) % 360;
  const diff = Math.abs(left - right);
  return Math.min(diff, 360 - diff);
}

export function formatAngle(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)} deg` : '--';
}

export function formatTime(value: string | null | undefined): string {
  if (!value) {
    return '--';
  }
  return new Date(value).toLocaleTimeString();
}

export function mapError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('host_hamlib_dependency_unavailable')) {
    return t('hostHamlibMissing');
  }
  if (message.includes('azimuth_out_of_soft_limits')) {
    return t('outOfLimit');
  }
  if (message.includes('rotator_not_connected')) {
    return t('notConnected');
  }
  return message;
}

export function displayAngleForNorthOffset(azimuth: number, northOffsetDeg: number): number {
  return normalizeDegrees(azimuth - northOffsetDeg);
}

export function getControlViewModel(snapshot: RotatorStateSnapshot) {
  const position = snapshot.position;
  const angle = position?.azimuth ?? snapshot.lastCommandedAzimuth ?? 0;
  const currentAngle = displayAngleForNorthOffset(angle, snapshot.config.northOffsetDeg);
  const rawTargetAngle = snapshot.movement?.targetAzimuth ?? snapshot.lastCommandedAzimuth ?? angle;
  const targetAngle = displayAngleForNorthOffset(rawTargetAngle, snapshot.config.northOffsetDeg);
  const stale = !position || position.stale;
  const disconnected = snapshot.status === 'disconnected';
  return {
    currentAngle,
    targetAngle,
    centerValue: disconnected
      ? t('status.disconnected')
      : position && !stale
        ? formatAngle(position.azimuth)
        : t('unknownPosition'),
    centerLabel: disconnected ? t('connectHint') : stale ? t('stalePosition') : t('truePosition'),
    updated: position?.updatedAt ? t('lastUpdated', undefined, { time: formatTime(position.updatedAt) }) : t('unknownPosition'),
    softLimits: `${t('softLimits')}: ${formatAngle(snapshot.config.softMinAz)} - ${formatAngle(snapshot.config.softMaxAz)}`,
  };
}

export function findSelectedModel(supportedRotators: SupportedRotatorInfo[], rotModel: number) {
  return supportedRotators.find((entry) => entry.rotModel === rotModel);
}
