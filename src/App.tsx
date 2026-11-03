/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import JSZip from 'jszip';
import mqtt, { MqttClient } from 'mqtt';
import { 
  Wifi, 
  Activity, 
  Cpu, 
  ShieldAlert, 
  Zap, 
  Download, 
  Sliders, 
  FileText, 
  Key, 
  Sun, 
  Moon, 
  Copy, 
  Check, 
  Play, 
  Pause, 
  RotateCcw, 
  Terminal, 
  ExternalLink,
  Usb,
  Radio,
  BookOpen,
  Info
} from 'lucide-react';

import { LedChannel, HardwareTelemetry, DeviceConfig, LogEntry } from './types';
import { WIRING_DOC, SETUP_DOC, API_DOC, README_DOC, generateFirmwareCode } from './docsContent';

// Default Configurations
const DEFAULT_CONFIG: DeviceConfig = {
  deviceId: 'ESP32-LED-CTRL-01',
  authToken: 'secret_token_1234',
  brokerWss: 'wss://broker.hivemq.com:8884/mqtt',
};

export default function App() {
  // Theme
  const [isDark, setIsDark] = useState<boolean>(() => {
    return localStorage.getItem('esp32_theme') !== 'light';
  });

  // Active Navigation Tab
  const [activeTab, setActiveTab] = useState<'dashboard' | 'wiring' | 'firmware' | 'docs'>('dashboard');
  const [activeDocSubtab, setActiveDocSubtab] = useState<'setup' | 'wiring' | 'api' | 'readme'>('setup');

  // Device & Connection Configuration
  const [config, setConfig] = useState<DeviceConfig>(() => {
    const saved = localStorage.getItem('esp32_ctrl_config');
    if (saved) {
      try {
        return { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
      } catch (e) {
        console.warn(e);
      }
    }
    return DEFAULT_CONFIG;
  });

  const [showPairingModal, setShowPairingModal] = useState<boolean>(false);
  const [connectionType, setConnectionType] = useState<'none' | 'mqtt' | 'serial'>('none');
  const [connectionStatus, setConnectionStatus] = useState<'offline' | 'connecting' | 'online'>('connecting');

  // Telemetry
  const [telemetry, setTelemetry] = useState<HardwareTelemetry>({
    online: false,
    ip: '--',
    ssid: '--',
    rssi: null,
    freeHeap: null,
    uptimeSec: 0,
    unauthorizedAttempts: 0,
    latencyMs: null
  });

  // LED Channels
  const [led1, setLed1] = useState<LedChannel>({
    pin: 13,
    mode: 'OFF',
    onMs: 500,
    offMs: 500,
    currentState: 0
  });

  const [led2, setLed2] = useState<LedChannel>({
    pin: 25,
    mode: 'OFF',
    onMs: 500,
    offMs: 500,
    currentState: 0
  });

  // Waveform State
  const [waveformPaused, setWaveformPaused] = useState<boolean>(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const waveHistoryRef = useRef<Array<{ time: number; led1: number; led2: number }>>([]);

  // Logs
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logsContainerRef = useRef<HTMLDivElement | null>(null);

  // Firmware Generator Inputs
  const [fwWifiSsid, setFwWifiSsid] = useState<string>('MyHomeWiFi');
  const [fwWifiPass, setFwWifiPass] = useState<string>('SecretPassword123');
  const [copiedCode, setCopiedCode] = useState<boolean>(false);

  // Refs for Clients and Timers
  const mqttClientRef = useRef<MqttClient | null>(null);
  const serialPortRef = useRef<any>(null);
  const serialWriterRef = useRef<any>(null);
  const pingStartRef = useRef<number>(0);
  const lastPacketTimeRef = useRef<number>(0);
  const debouncedSyncRef = useRef<{ [key: number]: any }>({});

  // Sync theme with HTML document element
  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('esp32_theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('esp32_theme', 'light');
    }
  }, [isDark]);

  // Log helper
  const addLog = useCallback((type: LogEntry['type'], text: string) => {
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');
    setLogs((prev) => [
      ...prev.slice(-150),
      { id: Math.random().toString(36).substring(2, 9), timestamp: timeStr, type, text }
    ]);
  }, []);

  // Scroll logs to bottom
  useEffect(() => {
    if (logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [logs]);

  // Save Config Helper
  const handleSaveConfig = (newCfg: DeviceConfig) => {
    setConfig(newCfg);
    localStorage.setItem('esp32_ctrl_config', JSON.stringify(newCfg));
    setShowPairingModal(false);
    addLog('info', `Pairing configuration saved for ${newCfg.deviceId}`);
  };

  // =============================================================================
  // COMMAND DISPATCHER
  // =============================================================================
  const sendCommand = useCallback((cmdData: Record<string, any>) => {
    const payload = {
      auth: config.authToken,
      deviceId: config.deviceId,
      ...cmdData
    };
    const jsonStr = JSON.stringify(payload);

    if (connectionType === 'serial' && serialWriterRef.current) {
      try {
        serialWriterRef.current.write(jsonStr + '\n');
        addLog('tx', `[Serial TX] ${jsonStr}`);
        return true;
      } catch (err: any) {
        addLog('error', `Serial write error: ${err.message}`);
        return false;
      }
    } else if (mqttClientRef.current && mqttClientRef.current.connected) {
      const topicCmd = `esp32ctrl/v1/${config.deviceId}/cmd`;
      mqttClientRef.current.publish(topicCmd, jsonStr, { qos: 1 });
      addLog('tx', `Published ${cmdData.cmd || 'COMMAND'} to ${topicCmd}`);
      return true;
    } else {
      addLog('warn', `Device is not connected. Connect via MQTT or USB to execute.`);
      return false;
    }
  }, [config.authToken, config.deviceId, connectionType, addLog]);

  // Send Ping
  const sendPing = useCallback(() => {
    pingStartRef.current = performance.now();
    sendCommand({ cmd: 'PING', nonce: Date.now() });
  }, [sendCommand]);

  // Set LED Mode and Param Helper
  const handleSetLed = useCallback((channelNum: 1 | 2, mode: 'OFF' | 'ON' | 'BLINK', onMs?: number, offMs?: number) => {
    const targetSetter = channelNum === 1 ? setLed1 : setLed2;
    const currentLed = channelNum === 1 ? led1 : led2;
    const finalOn = onMs !== undefined ? onMs : currentLed.onMs;
    const finalOff = offMs !== undefined ? offMs : currentLed.offMs;

    targetSetter((prev) => ({
      ...prev,
      mode,
      onMs: finalOn,
      offMs: finalOff,
      currentState: mode === 'OFF' ? 0 : 1
    }));

    sendCommand({
      cmd: 'SET_LED',
      led: channelNum,
      mode,
      onMs: finalOn,
      offMs: finalOff
    });
  }, [led1, led2, sendCommand]);

  // Slider change handler with debounce
  const handleSliderChange = (channelNum: 1 | 2, param: 'onMs' | 'offMs', value: number) => {
    const targetSetter = channelNum === 1 ? setLed1 : setLed2;
    targetSetter((prev) => ({ ...prev, [param]: value }));

    clearTimeout(debouncedSyncRef.current[channelNum]);
    debouncedSyncRef.current[channelNum] = setTimeout(() => {
      const targetLed = channelNum === 1 ? led1 : led2;
      const updatedOn = param === 'onMs' ? value : targetLed.onMs;
      const updatedOff = param === 'offMs' ? value : targetLed.offMs;
      if (targetLed.mode === 'BLINK') {
        sendCommand({
          cmd: 'SET_LED',
          led: channelNum,
          mode: 'BLINK',
          onMs: updatedOn,
          offMs: updatedOff
        });
      }
    }, 150);
  };

  // =============================================================================
  // INCOMING PACKET PROCESSOR
  // =============================================================================
  const handleIncomingJson = useCallback((raw: string) => {
    try {
      const data = JSON.parse(raw);
      lastPacketTimeRef.current = Date.now();

      // Check Pong Latency
      if (data.type === 'PONG') {
        if (pingStartRef.current > 0) {
          const rtt = Math.round(performance.now() - pingStartRef.current);
          setTelemetry((prev) => ({ ...prev, latencyMs: rtt }));
          pingStartRef.current = 0;
        }
        setConnectionStatus('online');
        return;
      }

      // Check Security Warning
      if (data.event === 'auth_failed') {
        addLog('security', `SECURITY ALERT: ESP32 rejected command! (Attempt #${data.unauthorizedCount || 1})`);
        setTelemetry((prev) => ({
          ...prev,
          unauthorizedAttempts: data.unauthorizedCount || prev.unauthorizedAttempts + 1
        }));
        return;
      }

      // Telemetry Packet
      if (data.online !== undefined) {
        setConnectionStatus(data.online ? 'online' : 'offline');
      }

      setTelemetry((prev) => ({
        ...prev,
        online: data.online ?? prev.online,
        ip: data.ip || prev.ip,
        ssid: data.ssid || prev.ssid,
        rssi: data.rssi !== undefined ? data.rssi : prev.rssi,
        freeHeap: data.freeHeap !== undefined ? data.freeHeap : prev.freeHeap,
        uptimeSec: data.uptimeSec !== undefined ? data.uptimeSec : prev.uptimeSec,
        unauthorizedAttempts: data.unauthorizedAttempts !== undefined ? data.unauthorizedAttempts : prev.unauthorizedAttempts
      }));

      // Synchronize actual hardware GPIO feedback
      if (data.led1) {
        setLed1((prev) => ({
          ...prev,
          mode: data.led1.mode || prev.mode,
          currentState: data.led1.state !== undefined ? data.led1.state : prev.currentState,
          onMs: data.led1.onMs || prev.onMs,
          offMs: data.led1.offMs || prev.offMs
        }));
      }

      if (data.led2) {
        setLed2((prev) => ({
          ...prev,
          mode: data.led2.mode || prev.mode,
          currentState: data.led2.state !== undefined ? data.led2.state : prev.currentState,
          onMs: data.led2.onMs || prev.onMs,
          offMs: data.led2.offMs || prev.offMs
        }));
      }
    } catch (e) {
      console.warn('JSON parse error on incoming packet:', e);
    }
  }, [addLog]);

  // =============================================================================
  // MQTT CONNECTION LIFECYCLE
  // =============================================================================
  useEffect(() => {
    if (connectionType === 'serial') return;

    setConnectionStatus('connecting');
    addLog('info', `Initiating Secure WSS MQTT connection to ${config.brokerWss}...`);

    const clientId = 'web_ctrl_' + Math.random().toString(16).substring(2, 10);
    const client = mqtt.connect(config.brokerWss, {
      clientId,
      clean: true,
      reconnectPeriod: 5000,
      connectTimeout: 10000
    });

    mqttClientRef.current = client;

    client.on('connect', () => {
      setConnectionType('mqtt');
      setConnectionStatus('online');
      addLog('info', `Connected to Secure MQTT broker! Client ID: ${clientId}`);

      const topicStatus = `esp32ctrl/v1/${config.deviceId}/status`;
      const topicTelemetry = `esp32ctrl/v1/${config.deviceId}/telemetry`;

      client.subscribe([topicStatus, topicTelemetry], (err) => {
        if (!err) {
          addLog('info', `Subscribed to ${topicStatus} and ${topicTelemetry}`);
          // Send initial ping to check if ESP32 is alive
          sendPing();
        } else {
          addLog('error', `Subscription error: ${err.message}`);
        }
      });
    });

    client.on('message', (topic, message) => {
      const payloadStr = message.toString();
      addLog('rx', `[${topic.split('/').pop()}] ${payloadStr}`);
      handleIncomingJson(payloadStr);
    });

    client.on('error', (err) => {
      addLog('error', `MQTT Error: ${err.message}`);
      setConnectionStatus('offline');
    });

    client.on('offline', () => {
      setConnectionStatus('offline');
    });

    return () => {
      client.end(true);
    };
  }, [config.brokerWss, config.deviceId, connectionType, addLog, handleIncomingJson, sendPing]);

  // Heartbeat watchdog: check if ESP32 timed out
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      if (connectionStatus === 'online') {
        if (lastPacketTimeRef.current > 0 && now - lastPacketTimeRef.current > 9000) {
          setConnectionStatus('offline');
          setTelemetry((prev) => ({ ...prev, latencyMs: null }));
          addLog('warn', 'ESP32 heartbeat timed out (> 9s without packet)');
        } else if (now - lastPacketTimeRef.current > 4000) {
          sendPing();
        }
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [connectionStatus, sendPing, addLog]);

  // =============================================================================
  // WEB SERIAL API (DIRECT USB CONNECTION)
  // =============================================================================
  const handleConnectSerial = async () => {
    if (!('serial' in navigator)) {
      alert('Web Serial API is not supported in this browser. Please use Google Chrome, Microsoft Edge, or Opera on desktop.');
      return;
    }

    try {
      addLog('info', 'Opening Web Serial port selector...');
      const port = await (navigator as any).serial.requestPort();
      await port.open({ baudRate: 115200 });
      serialPortRef.current = port;

      // Disconnect MQTT if connected to avoid dual control collisions
      if (mqttClientRef.current) {
        mqttClientRef.current.end();
      }

      setConnectionType('serial');
      setConnectionStatus('online');
      addLog('info', 'Web Serial connected successfully at 115200 baud!');

      // Setup writer
      const textEncoder = new TextEncoderStream();
      textEncoder.readable.pipeTo(port.writable);
      serialWriterRef.current = textEncoder.writable.getWriter();

      // Read loop
      const textDecoder = new TextDecoderStream();
      port.readable.pipeTo(textDecoder.writable);
      const reader = textDecoder.readable.getReader();

      let buffer = '';
      (async () => {
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) {
              buffer += value;
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';
              for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
                  handleIncomingJson(trimmed);
                } else if (trimmed.length > 0) {
                  addLog('rx', `[Serial] ${trimmed}`);
                }
              }
            }
          }
        } catch (e: any) {
          addLog('error', `Serial read loop terminated: ${e.message}`);
          setConnectionStatus('offline');
        }
      })();

      // Request telemetry
      sendCommand({ cmd: 'GET_TELEMETRY' });
    } catch (err: any) {
      addLog('error', `Web Serial connection canceled or failed: ${err.message}`);
    }
  };

  // =============================================================================
  // DIGITAL OSCILLOSCOPE CANVAS LOOP
  // =============================================================================
  useEffect(() => {
    let animId: number;

    const render = () => {
      const now = performance.now();

      // Local timing simulation if blinking
      if (led1.mode === 'BLINK') {
        const dur = led1.currentState ? led1.onMs : led1.offMs;
        if (!led1.localLastToggle) led1.localLastToggle = now;
        if (now - led1.localLastToggle >= dur) {
          setLed1((prev) => ({
            ...prev,
            currentState: prev.currentState ? 0 : 1,
            localLastToggle: now
          }));
        }
      }
      if (led2.mode === 'BLINK') {
        const dur = led2.currentState ? led2.onMs : led2.offMs;
        if (!led2.localLastToggle) led2.localLastToggle = now;
        if (now - led2.localLastToggle >= dur) {
          setLed2((prev) => ({
            ...prev,
            currentState: prev.currentState ? 0 : 1,
            localLastToggle: now
          }));
        }
      }

      // Record point
      if (!waveformPaused) {
        waveHistoryRef.current.push({
          time: now,
          led1: led1.currentState,
          led2: led2.currentState
        });

        // Prune older than 5000ms
        const cutoff = now - 5000;
        while (waveHistoryRef.current.length > 0 && waveHistoryRef.current[0].time < cutoff) {
          waveHistoryRef.current.shift();
        }
      }

      // Draw on canvas
      const cvs = canvasRef.current;
      if (cvs) {
        const ctx = cvs.getContext('2d');
        if (ctx) {
          const w = cvs.width;
          const h = cvs.height;

          // Clear
          ctx.fillStyle = isDark ? '#0b1120' : '#f8fafc';
          ctx.fillRect(0, 0, w, h);

          // Grid lines (vertical every 500ms over 4000ms window)
          const timeWindow = 4000;
          ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';
          ctx.lineWidth = 1;
          for (let t = 0; t <= timeWindow; t += 500) {
            const x = w - (t / timeWindow) * w;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
          }

          // Channel mid line
          const midY = h / 2;
          ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.1)';
          ctx.beginPath();
          ctx.moveTo(0, midY);
          ctx.lineTo(w, midY);
          ctx.stroke();

          // Trace coordinates
          const ch1High = 24;
          const ch1Low = midY - 18;
          const ch2High = midY + 24;
          const ch2Low = h - 18;

          // Channel Text Labels
          ctx.font = '10px "JetBrains Mono", monospace';
          ctx.fillStyle = isDark ? '#94a3b8' : '#64748b';
          ctx.fillText('GPIO 13 [HIGH: 3.3V / LOW: 0V]', 12, ch1High - 8);
          ctx.fillText('GPIO 25 [HIGH: 3.3V / LOW: 0V]', 12, ch2High - 8);

          // Render traces
          const drawWave = (isLed1: boolean, highY: number, lowY: number, color: string) => {
            const hist = waveHistoryRef.current;
            if (hist.length < 2) return;

            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();

            let started = false;
            let lastX = 0;
            let lastY = 0;

            for (let i = 0; i < hist.length; i++) {
              const pt = hist[i];
              const age = now - pt.time;
              if (age > timeWindow) continue;

              const x = w - (age / timeWindow) * w;
              const val = isLed1 ? pt.led1 : pt.led2;
              const y = val === 1 ? highY : lowY;

              if (!started) {
                ctx.moveTo(x, y);
                started = true;
              } else {
                ctx.lineTo(x, lastY);
                ctx.lineTo(x, y);
              }
              lastX = x;
              lastY = y;
            }

            if (started) {
              ctx.lineTo(w, lastY);
            }
            ctx.stroke();
          };

          drawWave(true, ch1High, ch1Low, '#06b6d4');  // Cyan for GPIO 13
          drawWave(false, ch2High, ch2Low, '#f59e0b'); // Amber for GPIO 25
        }
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [isDark, led1, led2, waveformPaused]);

  // Resize canvas observer
  useEffect(() => {
    const handleResize = () => {
      const cvs = canvasRef.current;
      if (cvs && cvs.parentElement) {
        cvs.width = cvs.parentElement.clientWidth;
        cvs.height = cvs.parentElement.clientHeight || 200;
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // =============================================================================
  // REPOSITORY ZIP PACKAGER (1-CLICK DOWNLOAD)
  // =============================================================================
  const handleDownloadZip = async () => {
    try {
      addLog('info', 'Generating complete GitHub Pages project ZIP archive...');
      const zip = new JSZip();

      // Read standalone static files
      const generatedIno = generateFirmwareCode({
        wifiSsid: fwWifiSsid,
        wifiPass: fwWifiPass,
        deviceId: config.deviceId,
        authToken: config.authToken,
        brokerHost: 'broker.hivemq.com'
      });

      let htmlText = '';
      let cssText = '';
      let jsText = '';

      try {
        const [resHtml, resCss, resJs] = await Promise.all([
          fetch('/ESP32-Web-Controller/index.html'),
          fetch('/ESP32-Web-Controller/style.css'),
          fetch('/ESP32-Web-Controller/script.js')
        ]);
        if (resHtml.ok) htmlText = await resHtml.text();
        if (resCss.ok) cssText = await resCss.text();
        if (resJs.ok) jsText = await resJs.text();
      } catch (e) {
        console.warn('Could not fetch static files dynamically:', e);
      }

      // Add actual subfolder structure
      const rootFolder = zip.folder('ESP32-Web-Controller');
      if (rootFolder) {
        if (htmlText) rootFolder.file('index.html', htmlText);
        if (cssText) rootFolder.file('style.css', cssText);
        if (jsText) rootFolder.file('script.js', jsText);
        rootFolder.file('README.md', README_DOC);
        rootFolder.folder('firmware')?.file('esp32_controller.ino', generatedIno);
        const docsFolder = rootFolder.folder('docs');
        docsFolder?.file('wiring.md', WIRING_DOC);
        docsFolder?.file('setup.md', SETUP_DOC);
        docsFolder?.file('api.md', API_DOC);
      }

      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ESP32-Web-Controller-GitHub-Pages.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      addLog('info', 'Project ZIP downloaded successfully!');
    } catch (err: any) {
      addLog('error', `Failed to generate ZIP: ${err.message}`);
    }
  };

  // Calculations for frequency and duty cycle
  const led1Total = led1.onMs + led1.offMs;
  const led1Freq = led1Total > 0 ? (1000 / led1Total).toFixed(2) : '0.00';
  const led1Duty = led1Total > 0 ? ((led1.onMs / led1Total) * 100).toFixed(1) : '0.0';

  const led2Total = led2.onMs + led2.offMs;
  const led2Freq = led2Total > 0 ? (1000 / led2Total).toFixed(2) : '0.00';
  const led2Duty = led2Total > 0 ? ((led2.onMs / led2Total) * 100).toFixed(1) : '0.0';

  // Firmware code generated with current settings
  const liveFirmwareCode = generateFirmwareCode({
    wifiSsid: fwWifiSsid,
    wifiPass: fwWifiPass,
    deviceId: config.deviceId,
    authToken: config.authToken,
    brokerHost: 'broker.hivemq.com'
  });

  return (
    <div className={`min-h-screen flex flex-col font-sans transition-colors duration-200 ${isDark ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'}`}>
      {/* =========================================================================
          TOP BAR CONTRACT (Single Line, 3 Zones)
          Zone 1: Wordmark Brand
          Zone 2: 4-5 Navigation Links
          Zone 3: Primary Actions (USB, Pairing, Theme, ZIP)
      ========================================================================= */}
      <header className={`sticky top-0 z-40 border-b backdrop-blur-md ${isDark ? 'bg-slate-900/90 border-slate-800' : 'bg-white/90 border-slate-200'}`}>
        <div className="max-w-7xl mx-auto px-3 sm:px-6 h-16 flex items-center justify-between gap-3 sm:gap-8">
          {/* Zone 1: Wordmark Brand */}
          <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center text-white shadow-sm shadow-cyan-500/20 shrink-0">
              <Zap className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-sm sm:text-base tracking-tight leading-tight whitespace-nowrap">
                <span className="sm:hidden">ESP32 Controller</span>
                <span className="hidden sm:inline">ESP32 Web Controller</span>
              </span>
              <span className="text-[10px] sm:text-[11px] font-mono text-cyan-500 leading-none">
                GitHub Pages Ready
              </span>
            </div>
          </div>

          {/* Zone 2: Navigation Links (Desktop) */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`whitespace-nowrap transition-colors pb-1 border-b-2 ${
                activeTab === 'dashboard'
                  ? 'text-cyan-500 border-cyan-500 font-semibold'
                  : 'text-slate-400 border-transparent hover:text-slate-200'
              }`}
            >
              Control Dashboard
            </button>
            <button
              onClick={() => setActiveTab('wiring')}
              className={`whitespace-nowrap transition-colors pb-1 border-b-2 ${
                activeTab === 'wiring'
                  ? 'text-cyan-500 border-cyan-500 font-semibold'
                  : 'text-slate-400 border-transparent hover:text-slate-200'
              }`}
            >
              Hardware Wiring
            </button>
            <button
              onClick={() => setActiveTab('firmware')}
              className={`whitespace-nowrap transition-colors pb-1 border-b-2 ${
                activeTab === 'firmware'
                  ? 'text-cyan-500 border-cyan-500 font-semibold'
                  : 'text-slate-400 border-transparent hover:text-slate-200'
              }`}
            >
              Firmware Generator
            </button>
            <button
              onClick={() => setActiveTab('docs')}
              className={`whitespace-nowrap transition-colors pb-1 border-b-2 ${
                activeTab === 'docs'
                  ? 'text-cyan-500 border-cyan-500 font-semibold'
                  : 'text-slate-400 border-transparent hover:text-slate-200'
              }`}
            >
              Documentation
            </button>
          </nav>

          {/* Zone 3: Header Actions */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            <button
              onClick={handleConnectSerial}
              className={`hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all whitespace-nowrap ${
                connectionType === 'serial'
                  ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400'
                  : isDark
                  ? 'bg-slate-800 border-slate-700 hover:bg-slate-700 text-slate-200'
                  : 'bg-slate-100 border-slate-300 hover:bg-slate-200 text-slate-700'
              }`}
              title="Connect directly over USB cable (Web Serial API)"
            >
              <Usb className="w-3.5 h-3.5" />
              <span>USB Serial</span>
            </button>

            <button
              onClick={() => setShowPairingModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 sm:py-1.5 text-xs font-semibold rounded-lg bg-cyan-600 hover:bg-cyan-500 active:bg-cyan-700 text-white shadow-sm transition-all whitespace-nowrap min-h-[38px] sm:min-h-0"
              title="Configure Device ID & Auth Key"
            >
              <Key className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Device Pairing</span>
              <span className="sm:hidden">Pairing</span>
            </button>

            <button
              onClick={handleDownloadZip}
              className={`hidden lg:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all whitespace-nowrap ${
                isDark
                  ? 'bg-slate-800 border-slate-700 hover:bg-slate-700 text-slate-200'
                  : 'bg-slate-100 border-slate-300 hover:bg-slate-200 text-slate-700'
              }`}
              title="Download entire repository ZIP formatted for GitHub Pages"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download ZIP</span>
            </button>

            <button
              onClick={() => setIsDark(!isDark)}
              className={`p-2 rounded-lg border transition-colors min-w-[38px] min-h-[38px] flex items-center justify-center ${
                isDark
                  ? 'bg-slate-800 border-slate-700 hover:bg-slate-700 text-amber-400'
                  : 'bg-slate-100 border-slate-300 hover:bg-slate-200 text-slate-600'
              }`}
              aria-label="Toggle Theme"
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      {/* =========================================================================
          MAIN VIEWPORT (with bottom padding on mobile for fixed bottom nav)
      ========================================================================= */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-4 sm:py-6 pb-28 md:pb-8 flex flex-col gap-6">
        {/* =====================================================================
            TAB 1: CONTROL DASHBOARD
        ===================================================================== */}
        {activeTab === 'dashboard' && (
          <>
            {/* Telemetry Strip */}
            <section
              aria-label="Device Hardware Telemetry"
              className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 sm:gap-4 p-3.5 sm:p-4 rounded-xl border ${
                isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
              }`}
            >
              {/* Connection Status */}
              <div className="flex flex-col gap-0.5 sm:gap-1 min-w-0">
                <span className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  ESP32 Status
                </span>
                <div className="flex items-center gap-1.5">
                  <span
                    className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                      connectionStatus === 'online'
                        ? 'bg-emerald-500 ring-4 ring-emerald-500/20'
                        : connectionStatus === 'connecting'
                        ? 'bg-amber-500 ring-4 ring-amber-500/20'
                        : 'bg-rose-500 ring-4 ring-rose-500/20'
                    }`}
                  />
                  <span className="text-xs sm:text-sm font-bold uppercase tracking-tight truncate">
                    {connectionStatus}
                  </span>
                </div>
              </div>

              {/* IP Address */}
              <div className="flex flex-col gap-0.5 sm:gap-1 min-w-0">
                <span className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  ESP32 Local IP
                </span>
                <span className="text-xs sm:text-sm font-mono font-semibold tabular-nums truncate">
                  {telemetry.ip}
                </span>
              </div>

              {/* Wi-Fi RSSI */}
              <div className="flex flex-col gap-0.5 sm:gap-1 min-w-0">
                <span className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Wi-Fi Signal
                </span>
                <div className="flex items-center gap-1 text-xs sm:text-sm font-mono tabular-nums truncate">
                  <Wifi className="w-3.5 h-3.5 text-cyan-500 shrink-0" />
                  <span className="truncate">{telemetry.ssid !== '--' ? telemetry.ssid : ''}</span>
                  <span className="text-cyan-400 font-semibold">{telemetry.rssi !== null ? `${telemetry.rssi} dBm` : '--'}</span>
                </div>
              </div>

              {/* Latency */}
              <div className="flex flex-col gap-0.5 sm:gap-1 min-w-0">
                <span className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  RTT Latency
                </span>
                <div className="flex items-center gap-1.5 text-xs sm:text-sm font-mono tabular-nums">
                  <Activity className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                  <span>{telemetry.latencyMs !== null ? `${telemetry.latencyMs} ms` : '--'}</span>
                </div>
              </div>

              {/* Free Heap */}
              <div className="flex flex-col gap-0.5 sm:gap-1 min-w-0">
                <span className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Free Memory
                </span>
                <div className="flex items-center gap-1.5 text-xs sm:text-sm font-mono tabular-nums truncate">
                  <Cpu className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                  <span>{telemetry.freeHeap ? `${(telemetry.freeHeap / 1024).toFixed(1)} KB` : '--'}</span>
                </div>
              </div>

              {/* Security Counter */}
              <div className="flex flex-col gap-0.5 sm:gap-1 min-w-0">
                <span className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Security (Rejections)
                </span>
                <div className="flex items-center gap-1.5 text-xs sm:text-sm font-mono tabular-nums text-emerald-500">
                  <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                  <span>{telemetry.unauthorizedAttempts}</span>
                </div>
              </div>
            </section>

            {/* Dual LED Controls Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
              {/* LED 1 Card (GPIO 13) */}
              <section
                aria-label="LED 1 Controls"
                className={`p-4 sm:p-6 rounded-2xl border flex flex-col gap-4 sm:gap-5 ${
                  isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
                }`}
              >
                <div className="flex items-center justify-between border-b pb-3.5 border-slate-800/60 dark:border-slate-800">
                  <div className="flex items-center gap-2.5 sm:gap-3">
                    <span className="px-2 py-0.5 text-xs font-mono font-bold rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                      GPIO 13
                    </span>
                    <h2 className="text-base sm:text-lg font-bold">LED 1 (Signal)</h2>
                  </div>
                  <div
                    className={`px-2.5 py-1 text-xs font-mono font-bold rounded flex items-center gap-1.5 transition-all ${
                      led1.currentState === 1
                        ? 'bg-cyan-500/15 text-cyan-400 shadow-lg shadow-cyan-500/20 ring-1 ring-cyan-500/30'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${led1.currentState === 1 ? 'bg-cyan-400' : 'bg-slate-500'}`} />
                    <span>{led1.currentState === 1 ? 'HIGH (3.3V)' : 'LOW (0V)'}</span>
                  </div>
                </div>

                {/* Segmented Mode Control (Touch Friendly) */}
                <div className="flex items-center p-1 rounded-xl bg-slate-800/80 border border-slate-700/60 gap-1">
                  {(['OFF', 'ON', 'BLINK'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => handleSetLed(1, m)}
                      className={`flex-1 py-2.5 sm:py-2 text-xs sm:text-sm font-semibold rounded-lg transition-all min-h-[42px] ${
                        led1.mode === m
                          ? 'bg-cyan-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>

                {/* Slider: ON Duration */}
                <div className="flex flex-col gap-1.5 sm:gap-2">
                  <div className="flex items-center justify-between text-xs font-medium text-slate-400">
                    <label htmlFor="led1-on-slider">Pulse ON Duration</label>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min="10"
                        max="5000"
                        step="10"
                        value={led1.onMs}
                        onChange={(e) => handleSliderChange(1, 'onMs', parseInt(e.target.value) || 10)}
                        className={`w-20 px-2 py-1.5 text-xs font-mono text-right rounded border tabular-nums ${
                          isDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-100 border-slate-300 text-slate-900'
                        }`}
                      />
                      <span>ms</span>
                    </div>
                  </div>
                  <input
                    id="led1-on-slider"
                    type="range"
                    min="20"
                    max="2000"
                    step="10"
                    value={led1.onMs}
                    onChange={(e) => handleSliderChange(1, 'onMs', parseInt(e.target.value))}
                    className="w-full accent-cyan-500 cursor-pointer h-7"
                  />
                </div>

                {/* Slider: OFF Duration */}
                <div className="flex flex-col gap-1.5 sm:gap-2">
                  <div className="flex items-center justify-between text-xs font-medium text-slate-400">
                    <label htmlFor="led1-off-slider">Pulse OFF Duration</label>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min="10"
                        max="5000"
                        step="10"
                        value={led1.offMs}
                        onChange={(e) => handleSliderChange(1, 'offMs', parseInt(e.target.value) || 10)}
                        className={`w-20 px-2 py-1.5 text-xs font-mono text-right rounded border tabular-nums ${
                          isDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-100 border-slate-300 text-slate-900'
                        }`}
                      />
                      <span>ms</span>
                    </div>
                  </div>
                  <input
                    id="led1-off-slider"
                    type="range"
                    min="20"
                    max="2000"
                    step="10"
                    value={led1.offMs}
                    onChange={(e) => handleSliderChange(1, 'offMs', parseInt(e.target.value))}
                    className="w-full accent-cyan-500 cursor-pointer h-7"
                  />
                </div>

                {/* Calculated Frequency and Duty Cycle */}
                <div className={`grid grid-cols-2 gap-2.5 sm:gap-3 p-3 sm:p-3.5 rounded-xl border ${isDark ? 'bg-slate-800/50 border-slate-800' : 'bg-slate-100/70 border-slate-200'}`}>
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase font-semibold text-slate-500">
                      Blinking Frequency
                    </span>
                    <span className="text-sm sm:text-base font-mono font-bold tabular-nums text-cyan-400">
                      {led1Freq} Hz
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase font-semibold text-slate-500">
                      Duty Cycle
                    </span>
                    <span className="text-sm sm:text-base font-mono font-bold tabular-nums text-cyan-400">
                      {led1Duty} %
                    </span>
                  </div>
                </div>

                {/* Presets (Touch targets >= 40px) */}
                <div className="flex items-center gap-2 flex-wrap text-xs pt-1">
                  <span className="text-slate-500 font-semibold">Presets:</span>
                  <button
                    onClick={() => handleSetLed(1, 'BLINK', 1000, 1000)}
                    className="px-3 py-2 sm:py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 transition-all min-h-[38px] flex items-center"
                  >
                    Slow (1s)
                  </button>
                  <button
                    onClick={() => handleSetLed(1, 'BLINK', 500, 500)}
                    className="px-3 py-2 sm:py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 transition-all min-h-[38px] flex items-center"
                  >
                    Normal (500ms)
                  </button>
                  <button
                    onClick={() => handleSetLed(1, 'BLINK', 100, 100)}
                    className="px-3 py-2 sm:py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 transition-all min-h-[38px] flex items-center"
                  >
                    Fast (100ms)
                  </button>
                  <button
                    onClick={() => handleSetLed(1, 'BLINK', 50, 450)}
                    className="px-3 py-2 sm:py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 transition-all min-h-[38px] flex items-center"
                  >
                    Strobe (50ms)
                  </button>
                </div>
              </section>

              {/* LED 2 Card (GPIO 25) */}
              <section
                aria-label="LED 2 Controls"
                className={`p-4 sm:p-6 rounded-2xl border flex flex-col gap-4 sm:gap-5 ${
                  isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
                }`}
              >
                <div className="flex items-center justify-between border-b pb-3.5 border-slate-800/60 dark:border-slate-800">
                  <div className="flex items-center gap-2.5 sm:gap-3">
                    <span className="px-2 py-0.5 text-xs font-mono font-bold rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                      GPIO 25
                    </span>
                    <h2 className="text-base sm:text-lg font-bold">LED 2 (Indicator)</h2>
                  </div>
                  <div
                    className={`px-2.5 py-1 text-xs font-mono font-bold rounded flex items-center gap-1.5 transition-all ${
                      led2.currentState === 1
                        ? 'bg-amber-500/15 text-amber-400 shadow-lg shadow-amber-500/20 ring-1 ring-amber-500/30'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${led2.currentState === 1 ? 'bg-amber-400' : 'bg-slate-500'}`} />
                    <span>{led2.currentState === 1 ? 'HIGH (3.3V)' : 'LOW (0V)'}</span>
                  </div>
                </div>

                {/* Segmented Mode Control */}
                <div className="flex items-center p-1 rounded-xl bg-slate-800/80 border border-slate-700/60 gap-1">
                  {(['OFF', 'ON', 'BLINK'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => handleSetLed(2, m)}
                      className={`flex-1 py-2.5 sm:py-2 text-xs sm:text-sm font-semibold rounded-lg transition-all min-h-[42px] ${
                        led2.mode === m
                          ? 'bg-amber-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>

                {/* Slider: ON Duration */}
                <div className="flex flex-col gap-1.5 sm:gap-2">
                  <div className="flex items-center justify-between text-xs font-medium text-slate-400">
                    <label htmlFor="led2-on-slider">Pulse ON Duration</label>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min="10"
                        max="5000"
                        step="10"
                        value={led2.onMs}
                        onChange={(e) => handleSliderChange(2, 'onMs', parseInt(e.target.value) || 10)}
                        className={`w-20 px-2 py-1.5 text-xs font-mono text-right rounded border tabular-nums ${
                          isDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-100 border-slate-300 text-slate-900'
                        }`}
                      />
                      <span>ms</span>
                    </div>
                  </div>
                  <input
                    id="led2-on-slider"
                    type="range"
                    min="20"
                    max="2000"
                    step="10"
                    value={led2.onMs}
                    onChange={(e) => handleSliderChange(2, 'onMs', parseInt(e.target.value))}
                    className="w-full accent-amber-500 cursor-pointer h-7"
                  />
                </div>

                {/* Slider: OFF Duration */}
                <div className="flex flex-col gap-1.5 sm:gap-2">
                  <div className="flex items-center justify-between text-xs font-medium text-slate-400">
                    <label htmlFor="led2-off-slider">Pulse OFF Duration</label>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min="10"
                        max="5000"
                        step="10"
                        value={led2.offMs}
                        onChange={(e) => handleSliderChange(2, 'offMs', parseInt(e.target.value) || 10)}
                        className={`w-20 px-2 py-1.5 text-xs font-mono text-right rounded border tabular-nums ${
                          isDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-100 border-slate-300 text-slate-900'
                        }`}
                      />
                      <span>ms</span>
                    </div>
                  </div>
                  <input
                    id="led2-off-slider"
                    type="range"
                    min="20"
                    max="2000"
                    step="10"
                    value={led2.offMs}
                    onChange={(e) => handleSliderChange(2, 'offMs', parseInt(e.target.value))}
                    className="w-full accent-amber-500 cursor-pointer h-7"
                  />
                </div>

                {/* Calculated Frequency and Duty Cycle */}
                <div className={`grid grid-cols-2 gap-2.5 sm:gap-3 p-3 sm:p-3.5 rounded-xl border ${isDark ? 'bg-slate-800/50 border-slate-800' : 'bg-slate-100/70 border-slate-200'}`}>
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase font-semibold text-slate-500">
                      Blinking Frequency
                    </span>
                    <span className="text-sm sm:text-base font-mono font-bold tabular-nums text-amber-400">
                      {led2Freq} Hz
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase font-semibold text-slate-500">
                      Duty Cycle
                    </span>
                    <span className="text-sm sm:text-base font-mono font-bold tabular-nums text-amber-400">
                      {led2Duty} %
                    </span>
                  </div>
                </div>

                {/* Presets */}
                <div className="flex items-center gap-2 flex-wrap text-xs pt-1">
                  <span className="text-slate-500 font-semibold">Presets:</span>
                  <button
                    onClick={() => handleSetLed(2, 'BLINK', 1000, 1000)}
                    className="px-3 py-2 sm:py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 transition-all min-h-[38px] flex items-center"
                  >
                    Slow (1s)
                  </button>
                  <button
                    onClick={() => handleSetLed(2, 'BLINK', 500, 500)}
                    className="px-3 py-2 sm:py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 transition-all min-h-[38px] flex items-center"
                  >
                    Normal (500ms)
                  </button>
                  <button
                    onClick={() => handleSetLed(2, 'BLINK', 100, 100)}
                    className="px-3 py-2 sm:py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 transition-all min-h-[38px] flex items-center"
                  >
                    Fast (100ms)
                  </button>
                  <button
                    onClick={() => handleSetLed(2, 'BLINK', 50, 450)}
                    className="px-3 py-2 sm:py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 transition-all min-h-[38px] flex items-center"
                  >
                    Strobe (50ms)
                  </button>
                </div>
              </section>
            </div>

            {/* Digital Waveform Oscilloscope */}
            <section
              aria-label="Digital Waveform Visualization"
              className={`p-4 sm:p-6 rounded-2xl border flex flex-col gap-3 sm:gap-4 ${
                isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm sm:text-base font-bold">Digital Logic Waveform (Oscilloscope)</h3>
                  <p className="text-xs text-slate-400">
                    Real-time digital square wave transitions (3.3V / 0V) across both GPIO channels
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-xs font-semibold">
                  <div className="flex items-center gap-1.5">
                    <span className="w-3.5 h-1 bg-cyan-400 rounded-sm" />
                    <span>GPIO 13</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-3.5 h-1 bg-amber-400 rounded-sm" />
                    <span>GPIO 25</span>
                  </div>
                  <button
                    onClick={() => setWaveformPaused(!waveformPaused)}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 text-xs flex items-center gap-1 min-h-[36px]"
                  >
                    {waveformPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                    <span>{waveformPaused ? 'Resume' : 'Pause'}</span>
                  </button>
                  <button
                    onClick={() => (waveHistoryRef.current = [])}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 text-xs flex items-center gap-1 min-h-[36px]"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Clear</span>
                  </button>
                </div>
              </div>

              <div className="w-full h-40 sm:h-48 md:h-52 rounded-xl border border-slate-800 overflow-hidden relative">
                <canvas ref={canvasRef} className="w-full h-full block" />
              </div>
            </section>

            {/* Communication Console & Diagnostic Logs */}
            <section
              aria-label="Communication Console"
              className={`p-4 sm:p-6 rounded-2xl border flex flex-col gap-3 ${
                isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-cyan-400" />
                  <h3 className="text-xs sm:text-sm font-bold">Live Communication & Security Log</h3>
                </div>
                <button
                  onClick={() => setLogs([])}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 min-h-[36px]"
                >
                  Clear Console
                </button>
              </div>

              <div
                ref={logsContainerRef}
                className="h-36 overflow-y-auto overflow-x-auto font-mono text-[11px] sm:text-xs p-3 rounded-lg bg-slate-950 border border-slate-800 flex flex-col gap-1.5"
              >
                {logs.length === 0 ? (
                  <span className="text-slate-600">Console ready. Event packets will stream here in real-time.</span>
                ) : (
                  logs.map((log) => {
                    let color = 'text-slate-400';
                    if (log.type === 'tx') color = 'text-sky-400';
                    if (log.type === 'rx') color = 'text-emerald-400';
                    if (log.type === 'warn') color = 'text-amber-400';
                    if (log.type === 'error' || log.type === 'security') color = 'text-rose-400 font-bold';
                    if (log.type === 'info') color = 'text-indigo-300';

                    return (
                      <div key={log.id} className="tabular-nums leading-relaxed">
                        <span className="text-slate-600">[{log.timestamp}]</span>{' '}
                        <span className={color}>[{log.type.toUpperCase()}]</span>{' '}
                        <span className="text-slate-300">{log.text}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          </>
        )}

        {/* =====================================================================
            TAB 2: HARDWARE WIRING & SCHEMATICS
        ===================================================================== */}
        {activeTab === 'wiring' && (
          <div className="flex flex-col gap-4 sm:gap-6">
            <div className={`p-4 sm:p-6 rounded-2xl border ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
              <h2 className="text-lg sm:text-xl font-bold mb-1.5">ESP32-WROOM-32 + Purple Expansion Board Schematic</h2>
              <p className="text-xs sm:text-sm text-slate-400 mb-4">
                Interactive connection diagram showing current-limiting resistors, GPIO signal pins, and common ground.
              </p>

              <span className="text-[11px] text-cyan-400 block mb-2 sm:hidden font-mono">
                ↔ Swipe horizontally to inspect circuit pins
              </span>

              {/* Interactive SVG Schematic with Mobile Horizontal Scroll */}
              <div className="w-full overflow-x-auto p-2 sm:p-4 bg-slate-950 rounded-xl border border-slate-800 flex justify-start sm:justify-center">
                <svg viewBox="0 0 880 440" className="w-full max-w-4xl h-auto min-w-[640px]">
                  {/* Expansion Board Base */}
                  <rect x="40" y="30" width="800" height="380" rx="16" fill="#2d124d" stroke="#582496" strokeWidth="3" />
                  <text x="440" y="60" fill="#d8b4fe" fontSize="14" fontWeight="bold" textAnchor="middle" fontFamily="sans-serif">
                    PURPLE ESP32 EXPANSION BOARD (30/38-PIN BREAKOUT)
                  </text>

                  {/* ESP32 Module */}
                  <rect x="260" y="90" width="360" height="260" rx="10" fill="#1e293b" stroke="#334155" strokeWidth="2" />
                  {/* Metal Shield */}
                  <rect x="330" y="110" width="220" height="150" rx="6" fill="#334155" stroke="#475569" strokeWidth="1" />
                  <text x="440" y="180" fill="#94a3b8" fontSize="16" fontWeight="bold" textAnchor="middle" fontFamily="sans-serif">
                    ESP32-WROOM-32
                  </text>
                  <text x="440" y="205" fill="#64748b" fontSize="12" textAnchor="middle" fontFamily="monospace">
                    Wi-Fi + BLE 2.4GHz
                  </text>

                  {/* Micro USB Port */}
                  <rect x="410" y="330" width="60" height="30" rx="4" fill="#64748b" />
                  <text x="440" y="375" fill="#94a3b8" fontSize="11" textAnchor="middle" fontFamily="sans-serif">USB</text>

                  {/* Left Expansion Header (GPIO 13) */}
                  <rect x="80" y="90" width="120" height="260" rx="8" fill="#1e1b4b" stroke="#3730a3" />
                  <text x="140" y="115" fill="#a5b4fc" fontSize="12" fontWeight="bold" textAnchor="middle">LEFT HEADERS</text>
                  
                  {/* GPIO 13 Pin Node */}
                  <circle cx="180" cy="190" r="7" fill="#06b6d4" />
                  <text x="165" y="195" fill="#06b6d4" fontSize="12" fontWeight="bold" textAnchor="end" fontFamily="monospace">GPIO 13</text>

                  {/* Right Expansion Header (GPIO 25 & GND) */}
                  <rect x="680" y="90" width="120" height="260" rx="8" fill="#1e1b4b" stroke="#3730a3" />
                  <text x="740" y="115" fill="#a5b4fc" fontSize="12" fontWeight="bold" textAnchor="middle">RIGHT HEADERS</text>
                  
                  {/* GPIO 25 Pin Node */}
                  <circle cx="700" cy="190" r="7" fill="#f59e0b" />
                  <text x="715" y="195" fill="#f59e0b" fontSize="12" fontWeight="bold" textAnchor="start" fontFamily="monospace">GPIO 25</text>

                  {/* Common GND Node */}
                  <circle cx="700" cy="270" r="7" fill="#64748b" />
                  <text x="715" y="275" fill="#cbd5e1" fontSize="12" fontWeight="bold" textAnchor="start" fontFamily="monospace">GND</text>

                  {/* Wiring Trace 1: GPIO 13 -> 220 Ohm -> LED 1 */}
                  <path d="M 180 190 L 100 190 L 100 370 L 220 370" fill="none" stroke="#06b6d4" strokeWidth="3" />
                  {/* Resistor 1 */}
                  <rect x="220" y="360" width="50" height="20" rx="4" fill="#d97706" stroke="#b45309" />
                  <text x="245" y="375" fill="#ffffff" fontSize="10" fontWeight="bold" textAnchor="middle">220 Ω</text>
                  <path d="M 270 370 L 310 370" fill="none" stroke="#06b6d4" strokeWidth="3" />
                  
                  {/* LED 1 Symbol */}
                  <circle cx="330" cy="370" r="14" fill="#06b6d4" opacity="0.9" />
                  <text x="330" y="374" fill="#ffffff" fontSize="10" fontWeight="bold" textAnchor="middle">LED 1</text>
                  <text x="330" y="402" fill="#06b6d4" fontSize="11" fontWeight="bold" textAnchor="middle">Signal (Blue/Green)</text>

                  {/* Wiring Trace 2: GPIO 25 -> 220 Ohm -> LED 2 */}
                  <path d="M 700 190 L 780 190 L 780 370 L 660 370" fill="none" stroke="#f59e0b" strokeWidth="3" />
                  {/* Resistor 2 */}
                  <rect x="610" y="360" width="50" height="20" rx="4" fill="#d97706" stroke="#b45309" />
                  <text x="635" y="375" fill="#ffffff" fontSize="10" fontWeight="bold" textAnchor="middle">220 Ω</text>
                  <path d="M 610 370 L 570 370" fill="none" stroke="#f59e0b" strokeWidth="3" />
                  
                  {/* LED 2 Symbol */}
                  <circle cx="550" cy="370" r="14" fill="#f59e0b" opacity="0.9" />
                  <text x="550" y="374" fill="#ffffff" fontSize="10" fontWeight="bold" textAnchor="middle">LED 2</text>
                  <text x="550" y="402" fill="#f59e0b" fontSize="11" fontWeight="bold" textAnchor="middle">Indicator (Red/Amber)</text>

                  {/* Common Return to GND */}
                  <path d="M 344 370 L 440 370 L 440 270 L 700 270" fill="none" stroke="#64748b" strokeWidth="2.5" strokeDasharray="5,5" />
                  <path d="M 536 370 L 440 370" fill="none" stroke="#64748b" strokeWidth="2.5" strokeDasharray="5,5" />
                  <text x="440" y="360" fill="#94a3b8" fontSize="11" textAnchor="middle" fontFamily="monospace">COMMON RETURN TO GND</text>
                </svg>
              </div>

              {/* Component Specifications Table */}
              <div className="mt-4 sm:mt-6 grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4 text-xs">
                <div className="p-3.5 sm:p-4 rounded-xl bg-slate-800/40 border border-slate-700/60">
                  <h4 className="font-bold text-sm text-cyan-400 mb-1">LED 1 (GPIO 13)</h4>
                  <p className="text-slate-300">Signal indicator. Connects to GPIO 13 via a 220Ω resistor. Safe current: ~2.3mA.</p>
                </div>
                <div className="p-3.5 sm:p-4 rounded-xl bg-slate-800/40 border border-slate-700/60">
                  <h4 className="font-bold text-sm text-amber-400 mb-1">LED 2 (GPIO 25)</h4>
                  <p className="text-slate-300">Status indicator. Connects to GPIO 25 via a 220Ω resistor. Safe current: ~6.0mA.</p>
                </div>
                <div className="p-3.5 sm:p-4 rounded-xl bg-slate-800/40 border border-slate-700/60">
                  <h4 className="font-bold text-sm text-purple-400 mb-1">Purple Expansion Board</h4>
                  <p className="text-slate-300">Set the voltage selection jumper to 3.3V. LED cathodes return to the common GND rail.</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* =====================================================================
            TAB 3: FIRMWARE GENERATOR
        ===================================================================== */}
        {activeTab === 'firmware' && (
          <div className="flex flex-col gap-4 sm:gap-6">
            <div className={`p-4 sm:p-6 rounded-2xl border ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-lg sm:text-xl font-bold">Interactive ESP32 Firmware Generator</h2>
                  <p className="text-xs sm:text-sm text-slate-400">
                    Customize your Wi-Fi credentials and auth token, then copy or download <code className="text-cyan-400">esp32_controller.ino</code>.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(liveFirmwareCode);
                      setCopiedCode(true);
                      setTimeout(() => setCopiedCode(false), 2000);
                    }}
                    className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-cyan-600 hover:bg-cyan-500 active:scale-95 text-white transition-all min-h-[38px]"
                  >
                    {copiedCode ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedCode ? 'Copied!' : 'Copy Code'}</span>
                  </button>
                  <button
                    onClick={() => {
                      const blob = new Blob([liveFirmwareCode], { type: 'text/plain;charset=utf-8' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = 'esp32_controller.ino';
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      URL.revokeObjectURL(url);
                    }}
                    className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 border border-slate-700 transition-all min-h-[38px]"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download .ino</span>
                  </button>
                </div>
              </div>

              {/* Customizer Inputs */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 p-3.5 sm:p-4 rounded-xl bg-slate-950 border border-slate-800 mb-4 sm:mb-6">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-slate-400">Wi-Fi SSID</label>
                  <input
                    type="text"
                    value={fwWifiSsid}
                    onChange={(e) => setFwWifiSsid(e.target.value)}
                    className="px-3 py-2 text-xs font-mono rounded-lg bg-slate-900 border border-slate-700 text-slate-100 focus:outline-none focus:border-cyan-500 min-h-[40px]"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-slate-400">Wi-Fi Password</label>
                  <input
                    type="password"
                    value={fwWifiPass}
                    onChange={(e) => setFwWifiPass(e.target.value)}
                    className="px-3 py-2 text-xs font-mono rounded-lg bg-slate-900 border border-slate-700 text-slate-100 focus:outline-none focus:border-cyan-500 min-h-[40px]"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-slate-400">Device ID</label>
                  <input
                    type="text"
                    value={config.deviceId}
                    onChange={(e) => setConfig({ ...config, deviceId: e.target.value })}
                    className="px-3 py-2 text-xs font-mono rounded-lg bg-slate-900 border border-slate-700 text-slate-100 focus:outline-none focus:border-cyan-500 min-h-[40px]"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-slate-400">Auth Token</label>
                  <input
                    type="text"
                    value={config.authToken}
                    onChange={(e) => setConfig({ ...config, authToken: e.target.value })}
                    className="px-3 py-2 text-xs font-mono rounded-lg bg-slate-900 border border-slate-700 text-slate-100 focus:outline-none focus:border-cyan-500 min-h-[40px]"
                  />
                </div>
              </div>

              {/* Code Viewer */}
              <div className="relative">
                <pre className="max-h-[450px] overflow-y-auto overflow-x-auto p-3.5 sm:p-4 rounded-xl bg-slate-950 border border-slate-800 font-mono text-[11px] sm:text-xs text-slate-300 leading-relaxed">
                  <code>{liveFirmwareCode}</code>
                </pre>
              </div>
            </div>
          </div>
        )}

        {/* =====================================================================
            TAB 4: DOCUMENTATION VIEWER
        ===================================================================== */}
        {activeTab === 'docs' && (
          <div className="flex flex-col gap-4 sm:gap-6">
            <div className={`p-4 sm:p-6 rounded-2xl border ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
              <div className="flex items-center gap-2 border-b pb-3 border-slate-800 mb-4 sm:mb-6 overflow-x-auto">
                {(['setup', 'wiring', 'api', 'readme'] as const).map((sub) => (
                  <button
                    key={sub}
                    onClick={() => setActiveDocSubtab(sub)}
                    className={`whitespace-nowrap px-3.5 py-2 text-xs font-semibold rounded-lg transition-all min-h-[38px] capitalize ${
                      activeDocSubtab === sub
                        ? 'bg-cyan-600 text-white shadow-sm'
                        : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {sub === 'api' ? 'API & Protocol' : sub === 'readme' ? 'README.md' : sub}
                  </button>
                ))}
              </div>

              <div className="prose prose-invert max-w-none text-slate-300 text-xs sm:text-sm leading-relaxed whitespace-pre-wrap font-sans break-words overflow-x-auto">
                {activeDocSubtab === 'setup' && SETUP_DOC}
                {activeDocSubtab === 'wiring' && WIRING_DOC}
                {activeDocSubtab === 'api' && API_DOC}
                {activeDocSubtab === 'readme' && README_DOC}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* =========================================================================
          DEVICE PAIRING & CREDENTIALS MODAL
      ========================================================================= */}
      {showPairingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className={`max-w-md w-full p-6 rounded-2xl border shadow-xl flex flex-col gap-4 ${
            isDark ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
          }`}>
            <div className="flex items-center justify-between border-b pb-3 border-slate-800">
              <h3 className="text-base font-bold">Device Pairing & Security Settings</h3>
              <button
                onClick={() => setShowPairingModal(false)}
                className="text-slate-400 hover:text-slate-200 p-1"
              >
                ✕
              </button>
            </div>

            <div className="p-3.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-xs text-slate-300 flex gap-2.5">
              <Key className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
              <span>
                <strong>Zero GitHub Secrets:</strong> Credentials are saved strictly in your browser's local storage and never committed to public repositories.
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-400">Target Device ID</label>
              <input
                type="text"
                value={config.deviceId}
                onChange={(e) => setConfig({ ...config, deviceId: e.target.value })}
                className={`px-3 py-2 text-xs font-mono rounded-lg border ${
                  isDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-300 text-slate-900'
                }`}
              />
              <span className="text-[11px] text-slate-500">Must match DEVICE_ID in your ESP32 .ino firmware.</span>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-400">Secret Auth Token / Passkey</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={config.authToken}
                  onChange={(e) => setConfig({ ...config, authToken: e.target.value })}
                  className={`flex-1 px-3 py-2 text-xs font-mono rounded-lg border ${
                    isDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => {
                    const rand = 'tok_' + Math.random().toString(36).substring(2, 10);
                    setConfig({ ...config, authToken: rand });
                  }}
                  className="px-3 py-2 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300"
                >
                  Generate
                </button>
              </div>
              <span className="text-[11px] text-slate-500">Only commands carrying this token are executed by your ESP32.</span>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-400">Secure MQTT Broker (WSS URL)</label>
              <select
                value={config.brokerWss}
                onChange={(e) => setConfig({ ...config, brokerWss: e.target.value })}
                className={`px-3 py-2 text-xs font-mono rounded-lg border ${
                  isDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-300 text-slate-900'
                }`}
              >
                <option value="wss://broker.hivemq.com:8884/mqtt">HiveMQ Public Broker (wss://broker.hivemq.com:8884/mqtt)</option>
                <option value="wss://broker.emqx.io:8084/mqtt">EMQX Public Broker (wss://broker.emqx.io:8084/mqtt)</option>
              </select>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => setShowPairingModal(false)}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
              >
                Cancel
              </button>
              <button
                onClick={() => handleSaveConfig(config)}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-semibold shadow-sm"
              >
                Save & Connect
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className={`border-t py-6 px-4 sm:px-6 text-xs text-slate-500 mb-16 md:mb-0 ${isDark ? 'bg-slate-900/50 border-slate-800' : 'bg-slate-100 border-slate-200'}`}>
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span>ESP32 Web Controller</span>
            <span>·</span>
            <span>GitHub Pages Ready</span>
            <span>·</span>
            <span className="font-mono text-cyan-500">{config.deviceId}</span>
          </div>
          <div>
            <span>WSS MQTT Secure Relay & Web Serial Dual-Mode</span>
          </div>
        </div>
      </footer>

      {/* =========================================================================
          FIXED MOBILE BOTTOM NAVIGATION DOCK (iOS / Android)
      ========================================================================= */}
      <nav
        aria-label="Mobile Bottom Navigation"
        className={`md:hidden fixed bottom-0 left-0 right-0 z-50 border-t backdrop-blur-xl px-2 py-1 transition-colors duration-200 ${
          isDark
            ? 'bg-slate-950/95 border-slate-800/90 shadow-[0_-4px_25px_rgba(0,0,0,0.6)]'
            : 'bg-white/95 border-slate-200/90 shadow-[0_-4px_25px_rgba(0,0,0,0.08)]'
        }`}
        style={{ paddingBottom: 'max(0.35rem, env(safe-area-inset-bottom, 8px))' }}
      >
        <div className="max-w-md mx-auto grid grid-cols-4 gap-1">
          {/* Dashboard Tab */}
          <button
            onClick={() => {
              setActiveTab('dashboard');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className={`py-1.5 px-1 rounded-xl flex flex-col items-center justify-center gap-1 transition-all active:scale-95 ${
              activeTab === 'dashboard'
                ? 'text-cyan-400 font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <div
              className={`p-1 rounded-lg transition-all ${
                activeTab === 'dashboard'
                  ? 'bg-cyan-500/20 text-cyan-400 shadow-sm shadow-cyan-500/20'
                  : 'text-slate-400'
              }`}
            >
              <Sliders className="w-5 h-5" />
            </div>
            <span className="text-[11px] font-medium leading-none tracking-tight">Dashboard</span>
          </button>

          {/* Wiring Tab */}
          <button
            onClick={() => {
              setActiveTab('wiring');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className={`py-1.5 px-1 rounded-xl flex flex-col items-center justify-center gap-1 transition-all active:scale-95 ${
              activeTab === 'wiring'
                ? 'text-cyan-400 font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <div
              className={`p-1 rounded-lg transition-all ${
                activeTab === 'wiring'
                  ? 'bg-cyan-500/20 text-cyan-400 shadow-sm shadow-cyan-500/20'
                  : 'text-slate-400'
              }`}
            >
              <Radio className="w-5 h-5" />
            </div>
            <span className="text-[11px] font-medium leading-none tracking-tight">Wiring</span>
          </button>

          {/* Firmware Tab */}
          <button
            onClick={() => {
              setActiveTab('firmware');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className={`py-1.5 px-1 rounded-xl flex flex-col items-center justify-center gap-1 transition-all active:scale-95 ${
              activeTab === 'firmware'
                ? 'text-cyan-400 font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <div
              className={`p-1 rounded-lg transition-all ${
                activeTab === 'firmware'
                  ? 'bg-cyan-500/20 text-cyan-400 shadow-sm shadow-cyan-500/20'
                  : 'text-slate-400'
              }`}
            >
              <Cpu className="w-5 h-5" />
            </div>
            <span className="text-[11px] font-medium leading-none tracking-tight">Firmware</span>
          </button>

          {/* Docs Tab */}
          <button
            onClick={() => {
              setActiveTab('docs');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className={`py-1.5 px-1 rounded-xl flex flex-col items-center justify-center gap-1 transition-all active:scale-95 ${
              activeTab === 'docs'
                ? 'text-cyan-400 font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <div
              className={`p-1 rounded-lg transition-all ${
                activeTab === 'docs'
                  ? 'bg-cyan-500/20 text-cyan-400 shadow-sm shadow-cyan-500/20'
                  : 'text-slate-400'
              }`}
            >
              <BookOpen className="w-5 h-5" />
            </div>
            <span className="text-[11px] font-medium leading-none tracking-tight">Docs</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
