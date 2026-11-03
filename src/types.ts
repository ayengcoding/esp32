/**
 * TypeScript Interfaces for ESP32 Web Controller
 */

export type LedMode = 'OFF' | 'ON' | 'BLINK';

export interface LedChannel {
  pin: number;
  mode: LedMode;
  onMs: number;
  offMs: number;
  currentState: number; // 0 or 1
  localLastToggle?: number;
}

export interface HardwareTelemetry {
  online: boolean;
  ip: string;
  ssid: string;
  rssi: number | null;
  freeHeap: number | null;
  uptimeSec: number;
  unauthorizedAttempts: number;
  latencyMs: number | null;
}

export interface DeviceConfig {
  deviceId: string;
  authToken: string;
  brokerWss: string;
}

export interface WavePoint {
  time: number;
  led1: number;
  led2: number;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  type: 'tx' | 'rx' | 'info' | 'warn' | 'error' | 'security';
  text: string;
}
