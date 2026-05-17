export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'moving' | 'error';

export interface RotatorPreset {
  label: string;
  azimuth: number;
}

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

export interface SupportedRotatorInfo {
  rotModel: number;
  modelName: string;
  mfgName: string;
  version: string;
  status: string;
  rotType: 'azimuth' | 'elevation' | 'azel' | 'other';
  rotTypeMask: number;
}

export interface PositionSnapshot {
  azimuth: number;
  elevation: number;
  source: 'hardware' | 'last-commanded';
  stale: boolean;
  updatedAt: string;
}

export interface DiagnosticLogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  detail?: string;
}

export interface RotatorStateSnapshot {
  status: ConnectionStatus;
  config: RotatorConfig;
  position: PositionSnapshot | null;
  lastCommandedAzimuth: number | null;
  caps: unknown;
  portCaps: unknown;
  configSchema: unknown[];
  connectionInfo: unknown;
  rotatorInfo: SupportedRotatorInfo | null;
  hamlibVersion: string | null;
  hardwareInfo: string;
  statusFlags: string[];
  movement: { targetAzimuth: number; startedAt: string; deadlineAt: string } | null;
  error: string | null;
  logs: DiagnosticLogEntry[];
}

export interface BootstrapResponse {
  state: RotatorStateSnapshot;
  supportedRotators: SupportedRotatorInfo[];
}

export type Banner = { type: 'error' | 'info'; message: string } | null;
export type TabId = 'control' | 'setup' | 'diagnostics';
