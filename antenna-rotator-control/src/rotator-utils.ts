export interface RotatorPreset {
  label: string;
  azimuth: number;
}

export const NETWORK_ROTCTL_MODEL = 2;
export const NETWORK_ROTCTL_MODEL_NAME = 'NET rotctl';

export interface RotatorConfig {
  connectionMode: 'serial' | 'network';
  rotModel: number;
  modelName: string;
  serialPort: string;
  networkAddress: string;
  conf: Record<string, string>;
  softMinAz: number;
  softMaxAz: number;
  homeAzimuth: number;
  northOffsetDeg: number;
  pollIntervalMs: number;
  movementTimeoutMs: number;
  largeStepThresholdDeg: number;
  presets: RotatorPreset[];
}

export const DEFAULT_CONFIG: RotatorConfig = {
  connectionMode: 'network',
  rotModel: NETWORK_ROTCTL_MODEL,
  modelName: NETWORK_ROTCTL_MODEL_NAME,
  serialPort: '',
  networkAddress: '127.0.0.1:4533',
  conf: {},
  softMinAz: 0,
  softMaxAz: 360,
  homeAzimuth: 0,
  northOffsetDeg: 0,
  pollIntervalMs: 1000,
  movementTimeoutMs: 90000,
  largeStepThresholdDeg: 90,
  presets: [
    { label: 'N', azimuth: 0 },
    { label: 'E', azimuth: 90 },
    { label: 'S', azimuth: 180 },
    { label: 'W', azimuth: 270 },
  ],
};

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function readNumber(value: unknown, fallback: number, min?: number, max?: number): number {
  const numberValue = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(numberValue)) {
    return fallback;
  }
  const low = min ?? Number.NEGATIVE_INFINITY;
  const high = max ?? Number.POSITIVE_INFINITY;
  return Math.min(high, Math.max(low, numberValue));
}

export function normalizeAzimuth(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

export function angularDistance(a: number, b: number): number {
  const diff = Math.abs(normalizeAzimuth(a) - normalizeAzimuth(b));
  return Math.min(diff, 360 - diff);
}

export function isAzimuthWithinSoftLimits(azimuth: number, minAz: number, maxAz: number): boolean {
  if (!Number.isFinite(azimuth) || !Number.isFinite(minAz) || !Number.isFinite(maxAz)) {
    return false;
  }
  if (minAz <= maxAz) {
    return azimuth >= minAz && azimuth <= maxAz;
  }
  return azimuth >= minAz || azimuth <= maxAz;
}

export function clampPollInterval(value: number): number {
  return Math.round(readNumber(value, DEFAULT_CONFIG.pollIntervalMs, 500, 10000));
}

export function coerceRotatorConfig(input: unknown, base: RotatorConfig = DEFAULT_CONFIG): RotatorConfig {
  const record = readRecord(input);
  const rawConnectionMode = readString(record.connectionMode, base.connectionMode);
  const connectionMode = rawConnectionMode === 'serial' ? 'serial' : 'network';
  const confRecord = readRecord(record.conf);
  const conf = Object.fromEntries(
    Object.entries(confRecord)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)]),
  );
  const presets = Array.isArray(record.presets)
    ? record.presets.flatMap((entry, index) => {
      const preset = readRecord(entry);
      const azimuth = readNumber(preset.azimuth, Number.NaN, -1080, 1080);
      if (!Number.isFinite(azimuth)) {
        return [];
      }
      const label = readString(preset.label, `P${index + 1}`).slice(0, 24) || `P${index + 1}`;
      return [{ label, azimuth }];
    }).slice(0, 24)
    : base.presets;

  const softMinAz = readNumber(record.softMinAz, base.softMinAz, -1080, 1080);
  const softMaxAz = readNumber(record.softMaxAz, base.softMaxAz, -1080, 1080);

  const requestedRotModel = Math.round(readNumber(record.rotModel, base.rotModel, 1, 999999));
  const requestedModelName = readString(record.modelName, base.modelName);

  return {
    connectionMode,
    rotModel: connectionMode === 'network' ? NETWORK_ROTCTL_MODEL : requestedRotModel,
    modelName: connectionMode === 'network' ? NETWORK_ROTCTL_MODEL_NAME : requestedModelName,
    serialPort: readString(record.serialPort, base.serialPort),
    networkAddress: readString(record.networkAddress, base.networkAddress),
    conf,
    softMinAz,
    softMaxAz,
    homeAzimuth: readNumber(record.homeAzimuth, base.homeAzimuth, -1080, 1080),
    northOffsetDeg: readNumber(record.northOffsetDeg, base.northOffsetDeg, -360, 360),
    pollIntervalMs: clampPollInterval(readNumber(record.pollIntervalMs, base.pollIntervalMs)),
    movementTimeoutMs: Math.round(readNumber(record.movementTimeoutMs, base.movementTimeoutMs, 5000, 600000)),
    largeStepThresholdDeg: readNumber(record.largeStepThresholdDeg, base.largeStepThresholdDeg, 1, 360),
    presets,
  };
}

export function getConnectionPort(config: RotatorConfig): string {
  return config.connectionMode === 'network' ? config.networkAddress.trim() : config.serialPort.trim();
}

export function requiresLargeStepConfirmation(currentAzimuth: number | undefined, targetAzimuth: number, thresholdDeg: number): boolean {
  if (currentAzimuth === undefined || !Number.isFinite(currentAzimuth)) {
    return false;
  }
  return angularDistance(currentAzimuth, targetAzimuth) > thresholdDeg;
}

export function validateTargetAzimuth(config: RotatorConfig, azimuth: number): void {
  if (!Number.isFinite(azimuth)) {
    throw new Error('invalid_azimuth');
  }
  if (!isAzimuthWithinSoftLimits(azimuth, config.softMinAz, config.softMaxAz)) {
    throw new Error('azimuth_out_of_soft_limits');
  }
}
