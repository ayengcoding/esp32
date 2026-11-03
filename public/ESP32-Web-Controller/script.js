/**
 * ESP32 Web Controller - Pure Vanilla JavaScript Controller
 * GitHub Pages Compatible (Relative links, zero Node.js server required)
 * 
 * Supports:
 *   1. Secure MQTT over WSS (HiveMQ / EMQX Public Brokers)
 *   2. Web Serial API (Direct USB cable connection in Chromium)
 *   3. Dual-channel Digital Waveform Oscilloscope Canvas
 *   4. Independent Non-blocking Dual LED Timing
 *   5. Token-based Command Authentication
 */

// =============================================================================
// STATE & CONFIGURATION
// =============================================================================
const DEFAULT_CONFIG = {
  deviceId: 'ESP32-LED-CTRL-01',
  authToken: 'secret_token_1234',
  brokerWss: 'wss://broker.hivemq.com:8884/mqtt',
  brokerType: 'hivemq'
};

const state = {
  // Config
  config: { ...DEFAULT_CONFIG },
  theme: localStorage.getItem('esp32_theme') || 'dark',

  // Connection
  connType: 'none', // 'mqtt' | 'serial' | 'none'
  status: 'offline', // 'offline' | 'connecting' | 'online'
  lastPacketTime: 0,
  latencyMs: null,
  pingNonce: null,
  pingStartTime: 0,

  // Hardware Telemetry
  ip: '--',
  ssid: '--',
  rssi: null,
  freeHeap: null,
  uptimeSec: 0,
  unauthorizedAttempts: 0,

  // LED 1 (GPIO 13)
  led1: {
    pin: 13,
    mode: 'OFF', // 'OFF' | 'ON' | 'BLINK'
    onMs: 500,
    offMs: 500,
    currentState: 0,
    localLastToggle: 0
  },

  // LED 2 (GPIO 25)
  led2: {
    pin: 25,
    mode: 'OFF',
    onMs: 500,
    offMs: 500,
    currentState: 0,
    localLastToggle: 0
  },

  // Oscilloscope Canvas
  waveformPaused: false,
  waveHistory: [] // Array of { time, led1, led2 }
};

// Network Clients
let mqttClient = null;
let serialPort = null;
let serialReader = null;
let serialWriter = null;
let serialInputDone = null;

// =============================================================================
// INITIALIZATION
// =============================================================================
document.addEventListener('DOMContentLoaded', () => {
  loadConfig();
  initTheme();
  initUIEventListeners();
  initCanvas();
  autoConnectMQTT();

  // Start animation loop for waveform & heartbeat watchdog
  requestAnimationFrame(renderWaveformLoop);
  setInterval(heartbeatWatchdog, 1000);
});

// =============================================================================
// STORAGE & SETTINGS
// =============================================================================
function loadConfig() {
  const saved = localStorage.getItem('esp32_ctrl_config');
  if (saved) {
    try {
      state.config = { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
    } catch (e) {
      console.warn('Failed to parse saved config:', e);
    }
  }
  updateConfigUI();
}

function saveConfig(newConfig) {
  state.config = { ...state.config, ...newConfig };
  localStorage.setItem('esp32_ctrl_config', JSON.stringify(state.config));
  updateConfigUI();
}

function updateConfigUI() {
  const devIdEl = document.getElementById('cfgDeviceId');
  const tokenEl = document.getElementById('cfgAuthToken');
  const brokerEl = document.getElementById('cfgBroker');
  const displayDevId = document.getElementById('displayDeviceId');

  if (devIdEl) devIdEl.value = state.config.deviceId;
  if (tokenEl) tokenEl.value = state.config.authToken;
  if (brokerEl) brokerEl.value = state.config.brokerWss;
  if (displayDevId) displayDevId.textContent = state.config.deviceId;
}

// =============================================================================
// THEME SWITCHER
// =============================================================================
function initTheme() {
  document.documentElement.setAttribute('data-theme', state.theme);
  const themeBtn = document.getElementById('themeToggleBtn');
  if (themeBtn) {
    themeBtn.innerHTML = state.theme === 'dark' ? '☀️ Light' : '🌙 Dark';
  }
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('esp32_theme', state.theme);
  document.documentElement.setAttribute('data-theme', state.theme);
  const themeBtn = document.getElementById('themeToggleBtn');
  if (themeBtn) {
    themeBtn.innerHTML = state.theme === 'dark' ? '☀️ Light' : '🌙 Dark';
  }
}

// =============================================================================
// SECURE MQTT OVER WSS
// =============================================================================
function autoConnectMQTT() {
  if (state.connType === 'serial') return;
  setConnectionStatus('connecting', 'Connecting to Secure MQTT Broker...');

  const clientId = 'web-ctrl-' + Math.random().toString(16).substring(2, 10);
  const topicCmd = `esp32ctrl/v1/${state.config.deviceId}/cmd`;
  const topicStatus = `esp32ctrl/v1/${state.config.deviceId}/status`;
  const topicTelemetry = `esp32ctrl/v1/${state.config.deviceId}/telemetry`;

  // Parse hostname and port from broker URL
  // Default HiveMQ: wss://broker.hivemq.com:8884/mqtt
  let host = 'broker.hivemq.com';
  let port = 8884;
  let path = '/mqtt';

  try {
    const url = new URL(state.config.brokerWss);
    host = url.hostname;
    port = parseInt(url.port) || (url.protocol === 'wss:' ? 8884 : 1883);
    path = url.pathname || '/mqtt';
  } catch (e) {
    console.warn('URL parsing fallback:', e);
  }

  logMessage('system', `Connecting to WSS MQTT: ${host}:${port}${path}`);

  // Use Paho MQTT if loaded
  if (typeof Paho !== 'undefined' && Paho.MQTT) {
    mqttClient = new Paho.MQTT.Client(host, port, path, clientId);

    mqttClient.onConnectionLost = (responseObject) => {
      if (responseObject.errorCode !== 0) {
        logMessage('warn', `MQTT Connection Lost: ${responseObject.errorMessage}`);
      }
      setConnectionStatus('offline', 'Disconnected from broker');
      // Retry in 5s
      setTimeout(autoConnectMQTT, 5000);
    };

    mqttClient.onMessageArrived = (message) => {
      handleIncomingPacket(message.destinationName, message.payloadString);
    };

    mqttClient.connect({
      useSSL: true,
      timeout: 10,
      keepAliveInterval: 30,
      cleanSession: true,
      onSuccess: () => {
        logMessage('info', `Connected to Secure MQTT Broker! Client: ${clientId}`);
        state.connType = 'mqtt';
        // Subscribe to topics
        mqttClient.subscribe(topicStatus, { qos: 1 });
        mqttClient.subscribe(topicTelemetry, { qos: 0 });
        logMessage('info', `Subscribed to: ${topicStatus} & ${topicTelemetry}`);
        
        // Probe ping
        sendPing();
      },
      onFailure: (err) => {
        logMessage('error', `MQTT connection failed: ${err.errorMessage || 'Network error'}`);
        setConnectionStatus('offline', 'Broker unreachable');
        setTimeout(autoConnectMQTT, 6000);
      }
    });
  } else {
    // Fallback: If Paho script is blocked, provide informative console log
    console.warn('Paho MQTT library not available. Check script tags in HTML.');
    setConnectionStatus('offline', 'MQTT library failed to load');
  }
}

function sendMqttCommand(payloadObj) {
  if (!mqttClient || !mqttClient.isConnected()) {
    logMessage('error', 'Cannot send command: MQTT client not connected');
    return false;
  }
  const topicCmd = `esp32ctrl/v1/${state.config.deviceId}/cmd`;
  const jsonStr = JSON.stringify(payloadObj);
  const message = new Paho.MQTT.Message(jsonStr);
  message.destinationName = topicCmd;
  message.qos = 1;
  mqttClient.send(message);
  logMessage('tx', `Published to ${topicCmd}: ${jsonStr}`);
  return true;
}

// =============================================================================
// WEB SERIAL API (DIRECT USB CABLE CONTROL)
// =============================================================================
async function connectWebSerial() {
  if (!('serial' in navigator)) {
    alert('Web Serial API is not supported in this browser. Please use Chrome, Edge, or Opera on desktop/Android.');
    return;
  }

  try {
    logMessage('system', 'Requesting Web Serial port...');
    serialPort = await navigator.serial.requestPort();
    await serialPort.open({ baudRate: 115200 });

    state.connType = 'serial';
    setConnectionStatus('online', 'Connected via USB Serial (115200 baud)');
    logMessage('info', 'Web Serial connected successfully at 115200 baud!');

    const textDecoder = new TextDecoderStream();
    serialInputDone = serialPort.readable.pipeTo(textDecoder.writable);
    serialReader = textDecoder.readable.getReader();

    // Start reading loop
    readSerialLoop();

    // Request initial telemetry
    sendCommand({ cmd: 'GET_TELEMETRY' });
  } catch (err) {
    logMessage('error', `Web Serial connection failed: ${err.message}`);
    setConnectionStatus('offline', 'Serial disconnected');
  }
}

async function readSerialLoop() {
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await serialReader.read();
      if (done) break;
      if (value) {
        buffer += value;
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep incomplete line
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            handleIncomingPacket('serial', trimmed);
          } else if (trimmed.length > 0) {
            logMessage('rx', `[ESP32 Serial] ${trimmed}`);
          }
        }
      }
    }
  } catch (err) {
    console.error('Serial read error:', err);
  }
}

async function sendSerialCommand(payloadObj) {
  if (!serialPort || !serialPort.writable) return false;
  try {
    const textEncoder = new TextEncoderStream();
    const writableStreamClosed = textEncoder.readable.pipeTo(serialPort.writable);
    const writer = textEncoder.writable.getWriter();
    const jsonStr = JSON.stringify(payloadObj) + '\n';
    await writer.write(jsonStr);
    writer.releaseLock();
    logMessage('tx', `[Serial TX] ${jsonStr.trim()}`);
    return true;
  } catch (err) {
    logMessage('error', `Serial write error: ${err.message}`);
    return false;
  }
}

// =============================================================================
// UNIFIED COMMAND DISPATCHER
// =============================================================================
function sendCommand(cmdData) {
  const payload = {
    auth: state.config.authToken,
    deviceId: state.config.deviceId,
    ...cmdData
  };

  if (state.connType === 'serial') {
    return sendSerialCommand(payload);
  } else if (state.connType === 'mqtt') {
    return sendMqttCommand(payload);
  } else {
    logMessage('warn', 'ESP32 is not connected. Connect via MQTT or USB first.');
    return false;
  }
}

function sendPing() {
  state.pingNonce = Date.now();
  state.pingStartTime = performance.now();
  sendCommand({
    cmd: 'PING',
    nonce: state.pingNonce
  });
}

// =============================================================================
// INCOMING PACKET HANDLER
// =============================================================================
function handleIncomingPacket(channel, rawPayload) {
  try {
    const data = JSON.parse(rawPayload);
    state.lastPacketTime = Date.now();

    // Check Pong
    if (data.type === 'PONG') {
      if (state.pingStartTime > 0) {
        state.latencyMs = Math.round(performance.now() - state.pingStartTime);
        state.pingStartTime = 0;
        updateTelemetryUI();
      }
      setConnectionStatus('online', 'ESP32 Online & Responsive');
      return;
    }

    // Check Security Alert
    if (data.event === 'auth_failed') {
      state.unauthorizedAttempts = data.unauthorizedCount || (state.unauthorizedAttempts + 1);
      logMessage('error', `SECURITY ALERT: ESP32 rejected command due to invalid Auth Token!`);
      updateTelemetryUI();
      return;
    }

    // Status or Telemetry Update
    if (data.online !== undefined) {
      if (data.online) {
        setConnectionStatus('online', 'ESP32 Online');
      } else {
        setConnectionStatus('offline', `ESP32 Offline (${data.reason || 'LWT'})`);
      }
    }

    if (data.ip) state.ip = data.ip;
    if (data.ssid) state.ssid = data.ssid;
    if (data.rssi !== undefined) state.rssi = data.rssi;
    if (data.freeHeap !== undefined) state.freeHeap = data.freeHeap;
    if (data.uptimeSec !== undefined) state.uptimeSec = data.uptimeSec;
    if (data.unauthorizedAttempts !== undefined) state.unauthorizedAttempts = data.unauthorizedAttempts;

    // Synchronize LED states from real ESP32 GPIO readings
    if (data.led1) {
      state.led1.mode = data.led1.mode || state.led1.mode;
      state.led1.currentState = data.led1.state !== undefined ? data.led1.state : state.led1.currentState;
      if (data.led1.onMs) state.led1.onMs = data.led1.onMs;
      if (data.led1.offMs) state.led1.offMs = data.led1.offMs;
      updateLedCardUI(1);
    }

    if (data.led2) {
      state.led2.mode = data.led2.mode || state.led2.mode;
      state.led2.currentState = data.led2.state !== undefined ? data.led2.state : state.led2.currentState;
      if (data.led2.onMs) state.led2.onMs = data.led2.onMs;
      if (data.led2.offMs) state.led2.offMs = data.led2.offMs;
      updateLedCardUI(2);
    }

    updateTelemetryUI();
  } catch (e) {
    console.warn('Failed to parse incoming payload:', e, rawPayload);
  }
}

// =============================================================================
// HEARTBEAT & CONNECTION STATUS
// =============================================================================
function setConnectionStatus(status, label) {
  state.status = status;
  const badgeEl = document.getElementById('connectionStatusBadge');
  const labelEl = document.getElementById('connectionStatusText');

  if (badgeEl && labelEl) {
    badgeEl.className = `status-badge ${status}`;
    labelEl.textContent = label || status.toUpperCase();
  }
}

function heartbeatWatchdog() {
  const now = Date.now();
  if (state.status === 'online') {
    // If no packet received for 8 seconds, mark as offline
    if (now - state.lastPacketTime > 8000) {
      setConnectionStatus('offline', 'ESP32 Unreachable (Timeout)');
      state.latencyMs = null;
      updateTelemetryUI();
    } else {
      // Send periodic ping every 4 seconds to track RTT latency
      if (now - state.lastPacketTime > 4000) {
        sendPing();
      }
    }
  }
}

// =============================================================================
// UI CONTROL HANDLERS
// =============================================================================
function initUIEventListeners() {
  // Theme toggle
  const themeBtn = document.getElementById('themeToggleBtn');
  if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

  // Pairing Modal
  const pairingBtn = document.getElementById('openPairingBtn');
  const closePairingBtn = document.getElementById('closePairingBtn');
  const savePairingBtn = document.getElementById('savePairingBtn');
  const modal = document.getElementById('pairingModal');

  if (pairingBtn && modal) {
    pairingBtn.addEventListener('click', () => modal.classList.add('open'));
  }
  if (closePairingBtn && modal) {
    closePairingBtn.addEventListener('click', () => modal.classList.remove('open'));
  }
  if (savePairingBtn && modal) {
    savePairingBtn.addEventListener('click', () => {
      const devId = document.getElementById('cfgDeviceId').value.trim();
      const token = document.getElementById('cfgAuthToken').value.trim();
      const broker = document.getElementById('cfgBroker').value.trim();

      if (!devId || !token) {
        alert('Please specify both Device ID and Auth Token.');
        return;
      }

      saveConfig({ deviceId: devId, authToken: token, brokerWss: broker });
      modal.classList.remove('open');
      logMessage('info', `Saved pairing credentials for ${devId}. Reconnecting...`);
      autoConnectMQTT();
    });
  }

  // Token Generator
  const genTokenBtn = document.getElementById('genTokenBtn');
  if (genTokenBtn) {
    genTokenBtn.addEventListener('click', () => {
      const randToken = 'tok_' + Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 6);
      const tokenInput = document.getElementById('cfgAuthToken');
      if (tokenInput) tokenInput.value = randToken;
    });
  }

  // Web Serial Button
  const serialBtn = document.getElementById('webSerialBtn');
  if (serialBtn) {
    serialBtn.addEventListener('click', connectWebSerial);
  }

  // LED 1 Mode buttons
  setupLedControls(1);
  // LED 2 Mode buttons
  setupLedControls(2);

  // Waveform controls
  const pauseWaveBtn = document.getElementById('pauseWaveformBtn');
  if (pauseWaveBtn) {
    pauseWaveBtn.addEventListener('click', () => {
      state.waveformPaused = !state.waveformPaused;
      pauseWaveBtn.textContent = state.waveformPaused ? '▶ Resume' : '⏸ Pause';
    });
  }

  const clearWaveBtn = document.getElementById('clearWaveformBtn');
  if (clearWaveBtn) {
    clearWaveBtn.addEventListener('click', () => {
      state.waveHistory = [];
    });
  }

  // Clear Logs
  const clearLogsBtn = document.getElementById('clearLogsBtn');
  if (clearLogsBtn) {
    clearLogsBtn.addEventListener('click', () => {
      const consoleEl = document.getElementById('logOutput');
      if (consoleEl) consoleEl.innerHTML = '';
    });
  }

  // Initial calculation render
  updateLedCalculations(1);
  updateLedCalculations(2);
}

function setupLedControls(ledNum) {
  const led = ledNum === 1 ? state.led1 : state.led2;
  const prefix = `led${ledNum}`;

  // Mode buttons
  ['Off', 'On', 'Blink'].forEach(m => {
    const btn = document.getElementById(`${prefix}Btn${m}`);
    if (btn) {
      btn.addEventListener('click', () => {
        const mode = m.toUpperCase();
        led.mode = mode;
        sendCommand({
          cmd: 'SET_LED',
          led: ledNum,
          mode: mode,
          onMs: led.onDurationMs,
          offMs: led.offDurationMs
        });
        updateLedCardUI(ledNum);
      });
    }
  });

  // Slider ON
  const sliderOn = document.getElementById(`${prefix}OnSlider`);
  const numOn = document.getElementById(`${prefix}OnNum`);
  if (sliderOn && numOn) {
    const syncOn = (val) => {
      const ms = Math.max(10, Math.min(10000, parseInt(val) || 500));
      led.onDurationMs = ms;
      sliderOn.value = ms;
      numOn.value = ms;
      updateLedCalculations(ledNum);
      if (led.mode === 'BLINK') {
        debouncedLedSync(ledNum);
      }
    };
    sliderOn.addEventListener('input', (e) => syncOn(e.target.value));
    numOn.addEventListener('change', (e) => syncOn(e.target.value));
  }

  // Slider OFF
  const sliderOff = document.getElementById(`${prefix}OffSlider`);
  const numOff = document.getElementById(`${prefix}OffNum`);
  if (sliderOff && numOff) {
    const syncOff = (val) => {
      const ms = Math.max(10, Math.min(10000, parseInt(val) || 500));
      led.offDurationMs = ms;
      sliderOff.value = ms;
      numOff.value = ms;
      updateLedCalculations(ledNum);
      if (led.mode === 'BLINK') {
        debouncedLedSync(ledNum);
      }
    };
    sliderOff.addEventListener('input', (e) => syncOff(e.target.value));
    numOff.addEventListener('change', (e) => syncOff(e.target.value));
  }

  // Presets
  const presets = [
    { id: `${prefix}PresetSlow`, on: 1000, off: 1000 },
    { id: `${prefix}PresetNormal`, on: 500, off: 500 },
    { id: `${prefix}PresetFast`, on: 100, off: 100 },
    { id: `${prefix}PresetStrobe`, on: 50, off: 450 }
  ];

  presets.forEach(p => {
    const el = document.getElementById(p.id);
    if (el) {
      el.addEventListener('click', () => {
        led.onDurationMs = p.on;
        led.offDurationMs = p.off;
        led.mode = 'BLINK';
        if (sliderOn) sliderOn.value = p.on;
        if (numOn) numOn.value = p.on;
        if (sliderOff) sliderOff.value = p.off;
        if (numOff) numOff.value = p.off;
        updateLedCalculations(ledNum);
        sendCommand({
          cmd: 'SET_LED',
          led: ledNum,
          mode: 'BLINK',
          onMs: p.on,
          offMs: p.off
        });
        updateLedCardUI(ledNum);
      });
    }
  });
}

// Debounce helper for rapid slider dragging
let debounceTimers = {};
function debouncedLedSync(ledNum) {
  clearTimeout(debounceTimers[ledNum]);
  debounceTimers[ledNum] = setTimeout(() => {
    const led = ledNum === 1 ? state.led1 : state.led2;
    sendCommand({
      cmd: 'SET_LED',
      led: ledNum,
      mode: led.mode,
      onMs: led.onDurationMs,
      offMs: led.offDurationMs
    });
  }, 120);
}

function updateLedCalculations(ledNum) {
  const led = ledNum === 1 ? state.led1 : state.led2;
  const prefix = `led${ledNum}`;
  const totalMs = led.onDurationMs + led.offDurationMs;
  const freqHz = totalMs > 0 ? (1000 / totalMs).toFixed(2) : '0.00';
  const dutyPct = totalMs > 0 ? ((led.onDurationMs / totalMs) * 100).toFixed(1) : '0.0';

  const freqEl = document.getElementById(`${prefix}Freq`);
  const dutyEl = document.getElementById(`${prefix}Duty`);
  if (freqEl) freqEl.textContent = `${freqHz} Hz`;
  if (dutyEl) dutyEl.textContent = `${dutyPct}%`;
}

function updateLedCardUI(ledNum) {
  const led = ledNum === 1 ? state.led1 : state.led2;
  const prefix = `led${ledNum}`;

  // Update active segmented tab
  ['Off', 'On', 'Blink'].forEach(m => {
    const btn = document.getElementById(`${prefix}Btn${m}`);
    if (btn) {
      if (led.mode === m.toUpperCase()) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    }
  });

  // State indicator
  const stateBadge = document.getElementById(`${prefix}StateBadge`);
  if (stateBadge) {
    const isHigh = led.currentState === 1;
    stateBadge.textContent = isHigh ? 'HIGH (3.3V)' : 'LOW (0V)';
    if (isHigh) {
      stateBadge.className = `state-indicator active-led${ledNum}`;
    } else {
      stateBadge.className = 'state-indicator';
    }
  }
}

function updateTelemetryUI() {
  const ipEl = document.getElementById('telemetryIp');
  const ssidEl = document.getElementById('telemetrySsid');
  const rssiEl = document.getElementById('telemetryRssi');
  const latencyEl = document.getElementById('telemetryLatency');
  const heapEl = document.getElementById('telemetryHeap');
  const uptimeEl = document.getElementById('telemetryUptime');
  const unauthEl = document.getElementById('telemetryUnauth');

  if (ipEl) ipEl.textContent = state.ip;
  if (ssidEl) ssidEl.textContent = state.ssid;
  if (rssiEl) {
    if (state.rssi !== null) {
      rssiEl.textContent = `${state.rssi} dBm`;
    } else {
      rssiEl.textContent = '--';
    }
  }
  if (latencyEl) {
    latencyEl.textContent = state.latencyMs !== null ? `${state.latencyMs} ms` : '--';
  }
  if (heapEl) {
    heapEl.textContent = state.freeHeap ? `${(state.freeHeap / 1024).toFixed(1)} KB` : '--';
  }
  if (uptimeEl) {
    const hrs = Math.floor(state.uptimeSec / 3600);
    const mins = Math.floor((state.uptimeSec % 3600) / 60);
    const secs = state.uptimeSec % 60;
    uptimeEl.textContent = `${hrs}h ${mins}m ${secs}s`;
  }
  if (unauthEl) {
    unauthEl.textContent = state.unauthorizedAttempts.toString();
  }
}

// =============================================================================
// LOGGING UTILITY
// =============================================================================
function logMessage(level, text) {
  const consoleEl = document.getElementById('logOutput');
  if (!consoleEl) return;

  const now = new Date();
  const timeStr = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');

  const line = document.createElement('div');
  line.style.padding = '2px 0';
  line.style.borderBottom = '1px solid rgba(255,255,255,0.03)';
  line.className = 'font-mono tabular-nums text-xs';

  let color = '#94a3b8';
  if (level === 'tx') color = '#38bdf8';
  if (level === 'rx') color = '#4ade80';
  if (level === 'warn') color = '#fbbf24';
  if (level === 'error') color = '#f87171';
  if (level === 'info') color = '#a78bfa';

  line.innerHTML = `<span style="color:#64748b;">[${timeStr}]</span> <span style="color:${color};font-weight:600;">[${level.toUpperCase()}]</span> <span>${escapeHtml(text)}</span>`;
  consoleEl.appendChild(line);

  // Auto-scroll
  consoleEl.scrollTop = consoleEl.scrollHeight;

  // Limit lines
  while (consoleEl.children.length > 200) {
    consoleEl.removeChild(consoleEl.firstChild);
  }
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[m]);
}

// =============================================================================
// DIGITAL WAVEFORM OSCILLOSCOPE (CANVAS)
// =============================================================================
let canvas = null;
let ctx = null;

function initCanvas() {
  canvas = document.getElementById('waveformCanvas');
  if (!canvas) return;
  ctx = canvas.getContext('2d');
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas() {
  if (!canvas || !canvas.parentElement) return;
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
}

function renderWaveformLoop() {
  const now = performance.now();

  // If blinking and offline or in-between telemetry updates, simulate waveform timing
  updateLocalLedSimulation(now);

  if (!state.waveformPaused) {
    // Record current snapshot
    state.waveHistory.push({
      time: now,
      led1: state.led1.currentState,
      led2: state.led2.currentState
    });

    // Prune history older than 5000ms
    const cutoff = now - 5000;
    while (state.waveHistory.length > 0 && state.waveHistory[0].time < cutoff) {
      state.waveHistory.shift();
    }
  }

  drawWaveform(now);
  requestAnimationFrame(renderWaveformLoop);
}

function updateLocalLedSimulation(now) {
  // If LED 1 is BLINK mode and no recent MQTT frame overridden
  [1, 2].forEach(num => {
    const led = num === 1 ? state.led1 : state.led2;
    if (led.mode === 'BLINK') {
      const dur = led.currentState ? led.onDurationMs : led.offDurationMs;
      if (!led.localLastToggle) led.localLastToggle = now;
      if (now - led.localLastToggle >= dur) {
        led.currentState = led.currentState ? 0 : 1;
        led.localLastToggle = now;
        updateLedCardUI(num);
      }
    } else if (led.mode === 'ON') {
      if (led.currentState !== 1) {
        led.currentState = 1;
        updateLedCardUI(num);
      }
    } else if (led.mode === 'OFF') {
      if (led.currentState !== 0) {
        led.currentState = 0;
        updateLedCardUI(num);
      }
    }
  });
}

function drawWaveform(now) {
  if (!canvas || !ctx) return;
  const width = canvas.width / window.devicePixelRatio;
  const height = canvas.height / window.devicePixelRatio;

  // Background clear
  ctx.fillStyle = state.theme === 'dark' ? '#0a0f1d' : '#f8fafc';
  ctx.fillRect(0, 0, width, height);

  // Grid lines
  ctx.strokeStyle = state.theme === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';
  ctx.lineWidth = 1;

  // Vertical time markers (every 500ms)
  const timeWindow = 4000; // 4 seconds total across width
  for (let t = 0; t <= timeWindow; t += 500) {
    const x = width - (t / timeWindow) * width;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  // Dual Channel Vertical Partitions
  // Top half: LED 1 (GPIO 13)
  // Bottom half: LED 2 (GPIO 25)
  const midY = height / 2;
  ctx.strokeStyle = state.theme === 'dark' ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.1)';
  ctx.beginPath();
  ctx.moveTo(0, midY);
  ctx.lineTo(width, midY);
  ctx.stroke();

  // Channel Baselines & Heights
  // Channel 1: High = 25px, Low = midY - 20px
  const ch1High = 28;
  const ch1Low = midY - 22;
  // Channel 2: High = midY + 28px, Low = height - 22px
  const ch2High = midY + 28;
  const ch2Low = height - 22;

  // Draw Channel Labels
  ctx.font = '10px "JetBrains Mono", monospace';
  ctx.fillStyle = state.theme === 'dark' ? '#94a3b8' : '#64748b';
  ctx.fillText('GPIO 13 (LED 1)', 12, ch1High - 10);
  ctx.fillText('GPIO 25 (LED 2)', 12, ch2High - 10);

  // Render traces from history
  if (state.waveHistory.length < 2) return;

  // Trace 1: LED 1 (Cyan #06b6d4)
  drawTrace(state.waveHistory, now, timeWindow, width, ch1High, ch1Low, '#06b6d4', 2);
  // Trace 2: LED 2 (Amber #f59e0b)
  drawTrace(state.waveHistory, now, timeWindow, width, ch2High, ch2Low, '#f59e0b', 2);
}

function drawTrace(history, now, timeWindow, canvasWidth, yHigh, yLow, color, lineWidth) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();

  let started = false;
  let lastX = 0;
  let lastY = 0;

  for (let i = 0; i < history.length; i++) {
    const point = history[i];
    const age = now - point.time;
    if (age > timeWindow) continue;

    const x = canvasWidth - (age / timeWindow) * canvasWidth;
    const y = (color.includes('06b6d4') ? point.led1 : point.led2) === 1 ? yHigh : yLow;

    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      // Digital square wave step: horizontal to x, then vertical to new y
      ctx.lineTo(x, lastY);
      ctx.lineTo(x, y);
    }

    lastX = x;
    lastY = y;
  }

  // Extend to right edge
  if (started) {
    ctx.lineTo(canvasWidth, lastY);
  }

  ctx.stroke();
}
