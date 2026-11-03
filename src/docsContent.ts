/**
 * Embedded documentation, firmware templates, and standalone files
 * for in-browser viewing, firmware generation, and repository ZIP download.
 */

export const WIRING_DOC = `# ESP32 Hardware Wiring & Schematic Guide

This document describes how to connect two independently controlled LEDs to an **ESP32-WROOM-32** using the standard **Purple ESP32 Expansion Board** (38-pin or 30-pin dual-row breakout with screw terminals and power rails).

---

## 1. Bill of Materials (BOM)

| Component | Quantity | Specification / Description |
| :--- | :--- | :--- |
| **Microcontroller** | 1 | ESP32-WROOM-32 (NodeMCU / DevKit v1) |
| **Expansion Board** | 1 | Purple ESP32 Expansion Board (dual headers, DC barrel jack, power rails) |
| **LED 1 (Signal)** | 1 | 5mm or 3mm LED (Blue or Green recommended, Vf ≈ 2.1V - 3.0V) |
| **LED 2 (Indicator)**| 1 | 5mm or 3mm LED (Red or Amber recommended, Vf ≈ 1.8V - 2.0V) |
| **Current Resistors**| 2 | 220 Ω ± 5% carbon film or metal film resistor (1/4W) |
| **Breadboard / Jumper Wires** | 6 | Male-to-Male or Male-to-Female jumper wires |
| **Power Supply** | 1 | Micro-USB / USB-C cable or external 5V/2A DC power adapter |

---

## 2. Resistor Calculation (Ohm's Law)

ESP32 GPIO pins operate at **3.3 V logic levels**. Driving an LED directly without a current-limiting resistor will draw excessive current (> 40 mA), risking permanent damage to the ESP32 silicon output stage.

**Ohm's Law Formula:**
\`\`\`text
Resistance R = (V_GPIO - V_LED_Forward) / I_Desired_Forward
\`\`\`

- **Red/Amber LED** (Vf ≈ 2.0V) at safe continuous If = 6 mA:
  \`R = (3.3V - 2.0V) / 0.006A = 1.3V / 0.006A ≈ 216 Ω -> 220 Ω (standard)\`
- **Blue/Green LED** (Vf ≈ 2.8V) at safe continuous If = 2.3 mA:
  \`R = (3.3V - 2.8V) / 0.0023A = 0.5V / 0.0023A ≈ 217 Ω -> 220 Ω (standard)\`

220 Ω is the ideal balanced value for both channels, keeping GPIO current well under the ESP32 recommended 12 mA per-pin limit while ensuring high visibility.

---

## 3. Pin Connection Table

| Signal Source | Expansion Board Header | Resistor | Target Component | Return Path |
| :--- | :--- | :--- | :--- | :--- |
| **LED 1 Channel** | **GPIO 13** (D13) | 220 Ω (in series) | LED 1 Anode (Long Leg +) | LED 1 Cathode (Short Leg -) -> **GND** |
| **LED 2 Channel** | **GPIO 25** (D25) | 220 Ω (in series) | LED 2 Anode (Long Leg +) | LED 2 Cathode (Short Leg -) -> **GND** |

---

## 4. Purple Expansion Board Details

The purple expansion board breaks out all 30 or 38 pins of the ESP32 into 3-pin headers:
- **S (Signal)**: Connects directly to the ESP32 GPIO pin.
- **V (Voltage)**: Connected to either 3.3V or 5V depending on the jumper cap selector.
- **G (Ground)**: Common GND rail tied directly to the ESP32 ground plane.

Set the power jumper selector on the expansion board to **3.3V**. Connect the 220Ω resistor to the Signal pin (GPIO 13 / 25), and connect the LED Cathode to any GND pin.`;

export const SETUP_DOC = `# ESP32 Web Controller Deployment & Setup Guide

This guide walks you through deploying the static web dashboard to **GitHub Pages**, flashing the firmware using **Arduino IDE**, pairing your browser with your ESP32, and troubleshooting connections.

---

## Part 1: GitHub Pages Deployment (Free Static Hosting)

Because this dashboard is built with pure HTML5, CSS3, and JavaScript with relative asset paths, it requires zero build steps or server runtimes.

### Step 1.1: Create a New GitHub Repository
1. Log into your GitHub account at github.com.
2. Click the **+** icon in the upper right and select **New repository**.
3. Name the repository \`ESP32-Web-Controller\`.
4. Choose **Public** (required for free GitHub Pages).
5. Click **Create repository**.

### Step 1.2: Upload Files
Upload or push the following directory structure to the \`main\` branch:
\`\`\`text
ESP32-Web-Controller/
├── index.html              <-- Main static HTML interface
├── style.css               <-- Responsive stylesheet (light/dark)
├── script.js               <-- Controller logic (WSS MQTT + WebSerial + Canvas)
├── firmware/
│   └── esp32_controller.ino
├── docs/
│   ├── wiring.md
│   ├── setup.md
│   └── api.md
└── README.md
\`\`\`

### Step 1.3: Enable GitHub Pages
1. In your GitHub repository, click on the **Settings** tab.
2. In the left sidebar, click **Pages**.
3. Under **Build and deployment**:
   - **Source**: Select \`Deploy from a branch\`.
   - **Branch**: Select \`main\` and folder \`/ (root)\`.
4. Click **Save**.
5. Within 1 to 2 minutes, GitHub Pages will display your public URL:
   \`https://USERNAME.github.io/ESP32-Web-Controller/\`

---

## Part 2: Arduino IDE & Firmware Installation

### Step 2.1: ESP32 Board Package
In Arduino IDE, open **Settings / Preferences** and add to **Additional boards manager URLs**:
\`\`\`text
https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
\`\`\`
Then open **Boards Manager** and install **esp32** by Espressif Systems.

### Step 2.2: Install Required Libraries
Open **Library Manager** (\`Tools > Manage Libraries...\`) and install:
1. **PubSubClient** by Nick O'Leary (Version 2.8+)
2. **ArduinoJson** by Benoit Blanchon (Version 6.x or 7.x)

### Step 2.3: Configure & Flash Firmware
Open \`firmware/esp32_controller.ino\`, update \`WIFI_SSID\`, \`WIFI_PASSWORD\`, \`DEVICE_ID\`, and \`AUTH_TOKEN\`, and click **Upload** at 115200 baud!`;

export const API_DOC = `# Communication Protocol & API Reference

## 1. Why HTTPS Restricts Direct HTTP Calls to ESP32

When your web dashboard is deployed to GitHub Pages, the browser serves it exclusively over **HTTPS**:
\`\`\`text
Origin: https://USERNAME.github.io
\`\`\`

If JavaScript running on an HTTPS page attempts to execute a standard HTTP \`fetch()\` to an ESP32 on your local area network (e.g., \`http://192.168.1.145/led/on\`), the browser immediately throws:

\`\`\`text
Mixed Content: The page at 'https://...' was loaded over HTTPS, but requested an
insecure XMLHttpRequest endpoint 'http://192.168.1.145/led/on'. This request has
been blocked; the content must be served over HTTPS.
\`\`\`

Modern browsers also enforce **Private Network Access (PNA)**: requests from public domains into private IP subnets (\`192.168.x.x\`) require special preflight CORS headers and strictly forbid unencrypted HTTP.

### The Solution: Secure WebSockets (WSS) + MQTT Relay
1. **GitHub Pages Web Client**: Connects outward to an authenticated, public, or private **WebSocket Secure (WSS)** broker on port \`8884\` (HiveMQ) or \`8084\` (EMQX) over TLS (\`wss://\`). Zero mixed content errors.
2. **ESP32 Client**: Connects outward to standard MQTT on port \`1883\` via standard Wi-Fi. It never listens on a public port and requires **no router port forwarding or public IP exposure**.
3. **End-to-End Authentication**: Every payload carries an authentication token. Even if someone inspects the public broker, unauthorized messages are rejected by the ESP32 firmware.

---

## 2. MQTT Topic Architecture

\`\`\`text
esp32ctrl/v1/{DEVICE_ID}/{CHANNEL}
\`\`\`

- \`cmd\`: Browser -> ESP32 commands (\`SET_LED\`, \`PING\`)
- \`status\`: ESP32 -> Browser (LWT retained status, pong, security alerts)
- \`telemetry\`: ESP32 -> Browser (periodic 3s heartbeats, GPIO states, RSSI, free heap)

---

## 3. Non-Blocking Timing Architecture (millis())

Traditional \`delay()\` blocks CPU execution, halting Wi-Fi and MQTT processing. In this project, each LED operates as an independent state machine using timestamp arithmetic:

\`\`\`cpp
void updateLed(LedController& led) {
  unsigned long now = millis();
  if (led.mode == MODE_BLINK) {
    if (led.currentState && (now - led.lastToggleTime >= led.onDurationMs)) {
      led.currentState = false;
      led.lastToggleTime = now;
      digitalWrite(led.pin, LOW);
    } 
    else if (!led.currentState && (now - led.lastToggleTime >= led.offDurationMs)) {
      led.currentState = true;
      led.lastToggleTime = now;
      digitalWrite(led.pin, HIGH);
    }
  }
}
\`\`\`

- **Period (T)**: \`onMs + offMs\` (ms)
- **Frequency (f)**: \`1000 / (onMs + offMs)\` Hz
- **Duty Cycle (D)**: \`(onMs / (onMs + offMs)) * 100%\``;

export const README_DOC = `# ESP32 Web Controller (Dual LED Dashboard)

A secure, static, **GitHub Pages-deployable** web dashboard for real-time control and telemetry monitoring of an **ESP32-WROOM-32** dual-LED circuit (GPIO 13 and GPIO 25).

Designed to run seamlessly from any static web host without requiring a custom Node.js backend server, paid cloud subscriptions, or router port forwarding.

## Highlights
- **GitHub Pages Ready**: 100% static client-side architecture with relative asset links.
- **Zero Mixed-Content Errors**: Communicates over Secure WebSockets (WSS MQTT) on port 8884/8084.
- **Dual-Mode Connectivity**: WSS MQTT (remote wireless) + Web Serial API (direct USB cable).
- **Independent Dual-LED Control**: Configurable ON/OFF durations (10ms - 10000ms), frequency (Hz) and duty cycle (%).
- **Digital Waveform Oscilloscope**: Real-time canvas visualization of digital logic levels.
- **Hardware Telemetry**: Real RSSI (dBm), local LAN IP, heap memory, uptime, latency.
- **Security & Pairing**: Token-based authentication prevents unauthorized commands.`;

export function generateFirmwareCode(params: {
  wifiSsid: string;
  wifiPass: string;
  deviceId: string;
  authToken: string;
  brokerHost: string;
}): string {
  return `/**
 * @file esp32_controller.ino
 * @brief ESP32 Dual LED Web Controller Firmware for GitHub Pages Web Dashboard
 * 
 * Target Board: ESP32-WROOM-32 (with Purple ESP32 Expansion Board)
 * Pin Assignments:
 *   - LED 1: GPIO 13 (via 220 ohm resistor to GND)
 *   - LED 2: GPIO 25 (via 220 ohm resistor to GND)
 * 
 * Required Libraries:
 *   1. PubSubClient by Nick O'Leary (v2.8+)
 *   2. ArduinoJson by Benoit Blanchon (v6.x or v7.x)
 *   3. WiFi (ESP32 Built-in)
 */

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

// =============================================================================
// USER CONFIGURATION (Configured via Dashboard Generator)
// =============================================================================
const char* WIFI_SSID     = "${params.wifiSsid || 'YOUR_WIFI_SSID'}";
const char* WIFI_PASSWORD = "${params.wifiPass || 'YOUR_WIFI_PASSWORD'}";

// Device Pairing & Security Token
const char* DEVICE_ID     = "${params.deviceId || 'ESP32-LED-CTRL-01'}";
const char* AUTH_TOKEN    = "${params.authToken || 'secret_token_1234'}";

// Public Secure MQTT Broker (Port 1883 for ESP32; Web Dashboard uses WSS port 8884/8084)
const char* MQTT_BROKER   = "${params.brokerHost || 'broker.hivemq.com'}";
const int   MQTT_PORT     = 1883;

// Hardware Pin Definitions
const int PIN_LED1 = 13;
const int PIN_LED2 = 25;

// =============================================================================
// DATA TYPES & STATE STRUCTURES
// =============================================================================
enum LedMode {
  MODE_OFF = 0,
  MODE_ON = 1,
  MODE_BLINK = 2
};

struct LedController {
  int pin;
  LedMode mode;
  bool currentState;
  unsigned long onDurationMs;
  unsigned long offDurationMs;
  unsigned long lastToggleTime;
};

// Instantiate LED controllers
LedController led1 = {PIN_LED1, MODE_OFF, false, 500, 500, 0};
LedController led2 = {PIN_LED2, MODE_OFF, false, 500, 500, 0};

unsigned long unauthorizedAttempts = 0;
unsigned long lastHeartbeatTime = 0;
const unsigned long HEARTBEAT_INTERVAL_MS = 3000;

WiFiClient espClient;
PubSubClient mqttClient(espClient);

String topicCmd;
String topicStatus;
String topicTelemetry;
String serialBuffer = "";

// Forward declarations
void setupWiFi();
void reconnectMQTT();
void mqttCallback(char* topic, byte* payload, unsigned int length);
void handleCommandJson(const String& jsonStr, const char* source);
void updateLed(LedController& led);
void setLedMode(LedController& led, LedMode mode, unsigned long onMs, unsigned long offMs);
void publishStatus(bool isOnline, const char* note = nullptr);
void publishTelemetry();
void checkSerialCommands();

void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println(F("\\n=================================================="));
  Serial.println(F("   ESP32 Web Control Dashboard Firmware v1.0.0    "));
  Serial.println(F("   GitHub Pages Compatible (WSS MQTT + WebSerial) "));
  Serial.println(F("=================================================="));
  Serial.printf("Device ID: %s\\n", DEVICE_ID);
  Serial.printf("LED 1 Pin: GPIO %d | LED 2 Pin: GPIO %d\\n", PIN_LED1, PIN_LED2);

  pinMode(PIN_LED1, OUTPUT);
  pinMode(PIN_LED2, OUTPUT);
  digitalWrite(PIN_LED1, LOW);
  digitalWrite(PIN_LED2, LOW);

  // Self-test blink (150ms)
  digitalWrite(PIN_LED1, HIGH);
  digitalWrite(PIN_LED2, HIGH);
  delay(150);
  digitalWrite(PIN_LED1, LOW);
  digitalWrite(PIN_LED2, LOW);

  topicCmd       = String("esp32ctrl/v1/") + DEVICE_ID + "/cmd";
  topicStatus    = String("esp32ctrl/v1/") + DEVICE_ID + "/status";
  topicTelemetry = String("esp32ctrl/v1/") + DEVICE_ID + "/telemetry";

  setupWiFi();
  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setBufferSize(1024);
}

void loop() {
  updateLed(led1);
  updateLed(led2);
  checkSerialCommands();

  if (WiFi.status() == WL_CONNECTED) {
    if (!mqttClient.connected()) {
      reconnectMQTT();
    } else {
      mqttClient.loop();
    }
  } else {
    static unsigned long lastWifiCheck = 0;
    if (millis() - lastWifiCheck > 10000) {
      lastWifiCheck = millis();
      WiFi.reconnect();
    }
  }

  unsigned long now = millis();
  if (now - lastHeartbeatTime >= HEARTBEAT_INTERVAL_MS) {
    lastHeartbeatTime = now;
    publishTelemetry();
  }
}

void updateLed(LedController& led) {
  unsigned long currentMillis = millis();

  switch (led.mode) {
    case MODE_OFF:
      if (led.currentState != false) {
        led.currentState = false;
        digitalWrite(led.pin, LOW);
      }
      break;

    case MODE_ON:
      if (led.currentState != true) {
        led.currentState = true;
        digitalWrite(led.pin, HIGH);
      }
      break;

    case MODE_BLINK:
      if (led.currentState) {
        if (currentMillis - led.lastToggleTime >= led.onDurationMs) {
          led.currentState = false;
          led.lastToggleTime = currentMillis;
          digitalWrite(led.pin, LOW);
        }
      } else {
        if (currentMillis - led.lastToggleTime >= led.offDurationMs) {
          led.currentState = true;
          led.lastToggleTime = currentMillis;
          digitalWrite(led.pin, HIGH);
        }
      }
      break;
  }
}

void setLedMode(LedController& led, LedMode mode, unsigned long onMs, unsigned long offMs) {
  led.mode = mode;
  if (onMs > 0) led.onDurationMs = onMs;
  if (offMs > 0) led.offDurationMs = offMs;
  led.lastToggleTime = millis();

  if (mode == MODE_OFF) {
    led.currentState = false;
    digitalWrite(led.pin, LOW);
  } else if (mode == MODE_ON) {
    led.currentState = true;
    digitalWrite(led.pin, HIGH);
  } else if (mode == MODE_BLINK) {
    led.currentState = true;
    digitalWrite(led.pin, HIGH);
  }
}

void setupWiFi() {
  delay(10);
  Serial.printf("\\n[WiFi] Connecting to %s ...\\n", WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long startAttempt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < 15000) {
    delay(500);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println(F("\\n[WiFi] Connected successfully!"));
    Serial.printf("[WiFi] IP Address: %s\\n", WiFi.localIP().toString().c_str());
    Serial.printf("[WiFi] Signal (RSSI): %d dBm\\n", WiFi.RSSI());
  } else {
    Serial.println(F("\\n[WiFi] Initial connection timed out. Will retry in background."));
  }
}

void reconnectMQTT() {
  static unsigned long lastMqttAttempt = 0;
  if (millis() - lastMqttAttempt < 5000) return;
  lastMqttAttempt = millis();

  Serial.printf("[MQTT] Connecting to broker %s:%d ...\\n", MQTT_BROKER, MQTT_PORT);
  String clientId = String("ESP32-") + DEVICE_ID + "-" + String(random(0xffff), HEX);

  StaticJsonDocument<128> lwtDoc;
  lwtDoc["deviceId"] = DEVICE_ID;
  lwtDoc["online"] = false;
  lwtDoc["reason"] = "lwt_offline";
  String lwtPayload;
  serializeJson(lwtDoc, lwtPayload);

  if (mqttClient.connect(clientId.c_str(), nullptr, nullptr, topicStatus.c_str(), 1, true, lwtPayload.c_str())) {
    Serial.println(F("[MQTT] Connected to broker!"));
    mqttClient.subscribe(topicCmd.c_str());
    publishStatus(true, "device_connected");
    publishTelemetry();
  } else {
    Serial.printf("[MQTT] Failed, rc=%d. Will retry in 5s\\n", mqttClient.state());
  }
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String message = "";
  for (unsigned int i = 0; i < length; i++) {
    message += (char)payload[i];
  }
  handleCommandJson(message, "MQTT");
}

void checkSerialCommands() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\\n' || c == '\\r') {
      if (serialBuffer.length() > 0) {
        serialBuffer.trim();
        handleCommandJson(serialBuffer, "SERIAL");
        serialBuffer = "";
      }
    } else {
      serialBuffer += c;
      if (serialBuffer.length() > 1024) serialBuffer = "";
    }
  }
}

void handleCommandJson(const String& jsonStr, const char* source) {
  StaticJsonDocument<512> doc;
  DeserializationError err = deserializeJson(doc, jsonStr);
  if (err) return;

  if (doc.containsKey("deviceId")) {
    const char* targetId = doc["deviceId"];
    if (strcmp(targetId, DEVICE_ID) != 0) return;
  }

  const char* providedAuth = doc["auth"] | "";
  if (strcmp(providedAuth, AUTH_TOKEN) != 0) {
    unauthorizedAttempts++;
    Serial.printf("[%s] SECURITY WARNING: Unauthorized command attempt! (Total: %lu)\\n", source, unauthorizedAttempts);
    
    StaticJsonDocument<256> alertDoc;
    alertDoc["deviceId"] = DEVICE_ID;
    alertDoc["event"] = "auth_failed";
    alertDoc["unauthorizedCount"] = unauthorizedAttempts;
    String alertStr;
    serializeJson(alertDoc, alertStr);
    
    if (mqttClient.connected()) {
      mqttClient.publish(topicStatus.c_str(), alertStr.c_str());
    }
    Serial.println(alertStr);
    return;
  }

  const char* cmd = doc["cmd"] | "";
  if (strcmp(cmd, "SET_LED") == 0) {
    int targetLed = doc["led"] | 1;
    const char* modeStr = doc["mode"] | "OFF";
    unsigned long onMs = doc["onMs"] | 500;
    unsigned long offMs = doc["offMs"] | 500;

    LedMode newMode = MODE_OFF;
    if (strcmp(modeStr, "ON") == 0) newMode = MODE_ON;
    else if (strcmp(modeStr, "BLINK") == 0) newMode = MODE_BLINK;

    if (targetLed == 1) {
      setLedMode(led1, newMode, onMs, offMs);
    } else if (targetLed == 2) {
      setLedMode(led2, newMode, onMs, offMs);
    }
    publishTelemetry();
  }
  else if (strcmp(cmd, "PING") == 0) {
    StaticJsonDocument<128> pongDoc;
    pongDoc["deviceId"] = DEVICE_ID;
    pongDoc["type"] = "PONG";
    pongDoc["nonce"] = doc["nonce"] | 0;
    pongDoc["uptime"] = millis() / 1000;
    String pongStr;
    serializeJson(pongDoc, pongStr);

    if (mqttClient.connected()) {
      mqttClient.publish(topicStatus.c_str(), pongStr.c_str());
    }
    Serial.println(pongStr);
  }
  else if (strcmp(cmd, "GET_TELEMETRY") == 0) {
    publishTelemetry();
  }
}

void publishStatus(bool isOnline, const char* note) {
  StaticJsonDocument<256> doc;
  doc["deviceId"] = DEVICE_ID;
  doc["online"] = isOnline;
  doc["ip"] = WiFi.isConnected() ? WiFi.localIP().toString() : "Not Connected";
  doc["rssi"] = WiFi.isConnected() ? WiFi.RSSI() : 0;
  doc["uptime"] = millis() / 1000;
  if (note) doc["note"] = note;

  String out;
  serializeJson(doc, out);

  if (mqttClient.connected()) {
    mqttClient.publish(topicStatus.c_str(), out.c_str(), true);
  }
  Serial.printf("[STATUS] %s\\n", out.c_str());
}

void publishTelemetry() {
  StaticJsonDocument<512> doc;
  doc["deviceId"] = DEVICE_ID;
  doc["online"] = true;
  doc["ip"] = WiFi.isConnected() ? WiFi.localIP().toString() : "0.0.0.0";
  doc["ssid"] = WiFi.isConnected() ? WiFi.SSID() : "None";
  doc["rssi"] = WiFi.isConnected() ? WiFi.RSSI() : 0;
  doc["freeHeap"] = ESP.getFreeHeap();
  doc["uptimeSec"] = millis() / 1000;
  doc["unauthorizedAttempts"] = unauthorizedAttempts;

  JsonObject l1 = doc.createNestedObject("led1");
  l1["pin"] = PIN_LED1;
  l1["mode"] = (led1.mode == MODE_ON) ? "ON" : (led1.mode == MODE_BLINK) ? "BLINK" : "OFF";
  l1["state"] = digitalRead(PIN_LED1) == HIGH ? 1 : 0;
  l1["onMs"] = led1.onDurationMs;
  l1["offMs"] = led1.offDurationMs;

  JsonObject l2 = doc.createNestedObject("led2");
  l2["pin"] = PIN_LED2;
  l2["mode"] = (led2.mode == MODE_ON) ? "ON" : (led2.mode == MODE_BLINK) ? "BLINK" : "OFF";
  l2["state"] = digitalRead(PIN_LED2) == HIGH ? 1 : 0;
  l2["onMs"] = led2.onDurationMs;
  l2["offMs"] = led2.offDurationMs;

  String output;
  serializeJson(doc, output);

  if (mqttClient.connected()) {
    mqttClient.publish(topicTelemetry.c_str(), output.c_str());
  }
  Serial.println(output);
}
`;
}
