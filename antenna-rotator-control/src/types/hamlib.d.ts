declare module 'hamlib' {
  export interface SupportedRotatorInfo {
    rotModel: number;
    modelName: string;
    mfgName: string;
    version: string;
    status: string;
    rotType: 'azimuth' | 'elevation' | 'azel' | 'other';
    rotTypeMask: number;
  }

  export interface RotatorConnectionInfo {
    connectionType: 'serial' | 'network';
    portPath: string;
    isOpen: boolean;
    originalModel: number;
    currentModel: number;
  }

  export interface RotatorPosition {
    azimuth: number;
    elevation: number;
  }

  export interface RotatorStatus {
    mask: number;
    flags: string[];
  }

  export type RotatorDirection =
    | 'UP'
    | 'DOWN'
    | 'LEFT'
    | 'RIGHT'
    | 'CCW'
    | 'CW'
    | 'UP_LEFT'
    | 'UP_RIGHT'
    | 'DOWN_LEFT'
    | 'DOWN_RIGHT'
    | 'UP_CCW'
    | 'UP_CW'
    | 'DOWN_CCW'
    | 'DOWN_CW'
    | number;

  export type HamlibConfigFieldType = 'string' | 'number' | 'boolean' | 'select' | 'range' | string;

  export interface HamlibConfigFieldDescriptor {
    token: string;
    name: string;
    label: string;
    tooltip?: string;
    defaultValue?: string | number | boolean;
    type: HamlibConfigFieldType;
    min?: number;
    max?: number;
    step?: number;
    options?: Array<{ label: string; value: string | number | boolean }>;
  }

  export interface HamlibPortCaps {
    portType: string;
    serialRateMin?: number;
    serialRateMax?: number;
    serialDataBits?: number[];
    stopBits?: number[];
    parity?: string[];
    handshake?: string[];
    writeDelay?: number;
    postWriteDelay?: number;
    timeout?: number;
    retry?: number;
  }

  export interface RotatorCaps {
    rotType: 'azimuth' | 'elevation' | 'azel' | 'other';
    rotTypeMask: number;
    minAz: number;
    maxAz: number;
    minEl: number;
    maxEl: number;
    supportedStatuses: string[];
  }

  export class Rotator {
    constructor(model: number, port?: string);
    static getSupportedRotators(): SupportedRotatorInfo[];
    static getHamlibVersion(): string;
    static setDebugLevel(level: number): void;
    open(): Promise<number>;
    close(): Promise<number>;
    destroy(): void;
    getConnectionInfo(): RotatorConnectionInfo;
    setPosition(azimuth: number, elevation: number): Promise<number>;
    getPosition(): Promise<RotatorPosition>;
    move(direction: RotatorDirection, speed: number): Promise<number>;
    stop(): Promise<number>;
    park(): Promise<number>;
    reset(resetType: 'ALL' | number): Promise<number>;
    getInfo(): Promise<string>;
    getStatus(): Promise<RotatorStatus>;
    setConf(name: string, value: string): Promise<number>;
    getConfigSchema(): HamlibConfigFieldDescriptor[];
    getPortCaps(): HamlibPortCaps;
    getRotatorCaps(): RotatorCaps;
  }
}
