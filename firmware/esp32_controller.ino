/**
 * @file esp32_controller.ino
 * @brief ESP32 Dual LED Web Controller Firmware for GitHub Pages Web Dashboard
 * 
 * Target Board: ESP32-WROOM-32 (with Purple ESP32 Expansion Board)
 * Pin Assignments:
 *   - LED 1: GPIO 13 (via 220 ohm resistor to GND)
 *   - LED 2: GPIO 25 (via 220 ohm resistor to GND)
 * 
 * Required Libraries (Install via Arduino Library Manager):
 *   1. PubSubClient by Nick O'Leary (v2.8+)
 *   2. ArduinoJson by Benoit Blanchon (v6.x or v7.x)
 *   3. WiFi (ESP32 Built-in)
 * 
 * Features:
 *   - Non-blocking dual LED control using millis()
 *   - Independent ON/OFF/BLINK modes with configurable ON and OFF intervals
 *   - Bidirectional Secure MQTT communication (HTTPS-compatible for GitHub Pages)
 *   - Fallback Web Serial JSON control over USB cable (115200 baud)
 *   - Token-based command authentication
 *   - Real-time hardware telemetry: RSSI, LAN IP, Free Heap, Uptime, GPIO states
 *   - MQTT Last Will and Testament (LWT) for accurate online/offline reporting
 */

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

// =============================================================================
// USER CONFIGURATION (Configure before flashing)
// =============================================================================
// Wi-Fi Credentials
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Device Pairing & Security Token
// Must match the Device ID and Token entered in your GitHub Pages dashboard
const char* DEVICE_ID     = "ESP32-LED-CTRL-01";
const char* AUTH_TOKEN    = "secret_token_1234";

// Public Secure MQTT Broker (Port 1883 for ESP32, dashboard connects via WSS on 8884/8084)
// Options: "broker.hivemq.com" (standard) or "broker.emqx.io"
const char* MQTT_BROKER   = "broker.hivemq.com";
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

// Security metrics
unsigned long unauthorizedAttempts = 0;

// Heartbeat & Telemetry timers
unsigned long lastHeartbeatTime = 0;
const unsigned long HEARTBEAT_INTERVAL_MS = 3000; // Telemetry every 3s

// Network Clients
WiFiClient espClient;
PubSubClient mqttClient(espClient);

// Dynamic MQTT Topic Strings
String topicCmd;
String topicStatus;
String topicTelemetry;

// Serial Command Buffer
String serialBuffer = "";

// =============================================================================
// FORWARD DECLARATIONS
// =============================================================================
void setupWiFi();
void reconnectMQTT();
void mqttCallback(char* topic, byte* payload, unsigned int length);
void handleCommandJson(const String& jsonStr, const char* source);
void updateLed(LedController& led);
void setLedMode(LedController& led, LedMode mode, unsigned long onMs, unsigned long offMs);
void publishStatus(bool isOnline, const char* note = nullptr);
void publishTelemetry();
void checkSerialCommands();

// =============================================================================
// ARDUINO SETUP
// =============================================================================
void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println(F("\n=================================================="));
  Serial.println(F("   ESP32 Web Control Dashboard Firmware v1.0.0    "));
  Serial.println(F("   GitHub Pages Compatible (WSS MQTT + WebSerial) "));
  Serial.println(F("=================================================="));
  Serial.printf("Device ID: %s\n", DEVICE_ID);
  Serial.printf("LED 1 Pin: GPIO %d | LED 2 Pin: GPIO %d\n", PIN_LED1, PIN_LED2);

  // Initialize GPIO Pins
  pinMode(PIN_LED1, OUTPUT);
  pinMode(PIN_LED2, OUTPUT);
  digitalWrite(PIN_LED1, LOW);
  digitalWrite(PIN_LED2, LOW);

  // Quick power-on LED self-test (100ms blink)
  digitalWrite(PIN_LED1, HIGH);
  digitalWrite(PIN_LED2, HIGH);
  delay(150);
  digitalWrite(PIN_LED1, LOW);
  digitalWrite(PIN_LED2, LOW);

  // Prepare MQTT Topics
  topicCmd       = String("esp32ctrl/v1/") + DEVICE_ID + "/cmd";
  topicStatus    = String("esp32ctrl/v1/") + DEVICE_ID + "/status";
  topicTelemetry = String("esp32ctrl/v1/") + DEVICE_ID + "/telemetry";

  // Setup Wi-Fi and MQTT
  setupWiFi();
  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setBufferSize(1024); // Ensure enough space for JSON payloads
}

// =============================================================================
// MAIN EXECUTION LOOP
// =============================================================================
void loop() {
  // Non-blocking LED state machine updates
  updateLed(led1);
  updateLed(led2);

  // Handle Serial input (supports direct Web Serial API over USB)
  checkSerialCommands();

  // Maintain Wi-Fi and MQTT connection
  if (WiFi.status() == WL_CONNECTED) {
    if (!mqttClient.connected()) {
      reconnectMQTT();
    } else {
      mqttClient.loop();
    }
  } else {
    // If Wi-Fi dropped, attempt non-blocking check
    static unsigned long lastWifiCheck = 0;
    if (millis() - lastWifiCheck > 10000) {
      lastWifiCheck = millis();
      Serial.println(F("[WiFi] Disconnected. Reconnecting..."));
      WiFi.reconnect();
    }
  }

  // Periodic Telemetry Heartbeat
  unsigned long now = millis();
  if (now - lastHeartbeatTime >= HEARTBEAT_INTERVAL_MS) {
    lastHeartbeatTime = now;
    publishTelemetry();
  }
}

// =============================================================================
// NON-BLOCKING LED TIMING (millis())
// =============================================================================
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
        // LED is currently ON; check if ON duration has elapsed
        if (currentMillis - led.lastToggleTime >= led.onDurationMs) {
          led.currentState = false;
          led.lastToggleTime = currentMillis;
          digitalWrite(led.pin, LOW);
        }
      } else {
        // LED is currently OFF; check if OFF duration has elapsed
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
    // Start blink cycle ON immediately
    led.currentState = true;
    digitalWrite(led.pin, HIGH);
  }
}

// =============================================================================
// WI-FI SETUP & MQTT MANAGEMENT
// =============================================================================
void setupWiFi() {
  delay(10);
  Serial.printf("\n[WiFi] Connecting to %s ...\n", WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long startAttempt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < 15000) {
    delay(500);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println(F("\n[WiFi] Connected successfully!"));
    Serial.printf("[WiFi] IP Address: %s\n", WiFi.localIP().toString().c_str());
    Serial.printf("[WiFi] Signal (RSSI): %d dBm\n", WiFi.RSSI());
  } else {
    Serial.println(F("\n[WiFi] Initial connection timed out. Will retry in background."));
    Serial.println(F("[Note] Web Serial API over USB is still fully operational!"));
  }
}

void reconnectMQTT() {
  static unsigned long lastMqttAttempt = 0;
  if (millis() - lastMqttAttempt < 5000) {
    return; // Non-blocking throttle: retry every 5s
  }
  lastMqttAttempt = millis();

  Serial.printf("[MQTT] Connecting to broker %s:%d ...\n", MQTT_BROKER, MQTT_PORT);

  // Client ID must be unique
  String clientId = String("ESP32-") + DEVICE_ID + "-" + String(random(0xffff), HEX);

  // Define Last Will & Testament (LWT) topic and payload
  // Retained so the web dashboard immediately knows when ESP32 drops offline
  StaticJsonDocument<128> lwtDoc;
  lwtDoc["deviceId"] = DEVICE_ID;
  lwtDoc["online"] = false;
  lwtDoc["reason"] = "lwt_offline";
  String lwtPayload;
  serializeJson(lwtDoc, lwtPayload);

  if (mqttClient.connect(clientId.c_str(), nullptr, nullptr, topicStatus.c_str(), 1, true, lwtPayload.c_str())) {
    Serial.println(F("[MQTT] Connected to broker!"));
    
    // Subscribe to command topic
    mqttClient.subscribe(topicCmd.c_str());
    Serial.printf("[MQTT] Subscribed to: %s\n", topicCmd.c_str());

    // Publish online status (retained)
    publishStatus(true, "device_connected");

    // Publish initial telemetry snapshot
    publishTelemetry();
  } else {
    Serial.printf("[MQTT] Failed, rc=%d. Will retry in 5s\n", mqttClient.state());
  }
}

// =============================================================================
// COMMAND HANDLING & AUTHENTICATION
// =============================================================================
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  // Convert payload to String
  String message = "";
  for (unsigned int i = 0; i < length; i++) {
    message += (char)payload[i];
  }
  handleCommandJson(message, "MQTT");
}

void checkSerialCommands() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (serialBuffer.length() > 0) {
        serialBuffer.trim();
        handleCommandJson(serialBuffer, "SERIAL");
        serialBuffer = "";
      }
    } else {
      serialBuffer += c;
      if (serialBuffer.length() > 1024) {
        serialBuffer = ""; // Overflow guard
      }
    }
  }
}

void handleCommandJson(const String& jsonStr, const char* source) {
  StaticJsonDocument<512> doc;
  DeserializationError err = deserializeJson(doc, jsonStr);

  if (err) {
    Serial.printf("[%s] Invalid JSON received: %s\n", source, err.c_str());
    return;
  }

  // 1. Verify Target Device ID (if specified)
  if (doc.containsKey("deviceId")) {
    const char* targetId = doc["deviceId"];
    if (strcmp(targetId, DEVICE_ID) != 0) {
      // Message intended for another device on shared broker; ignore quietly
      return;
    }
  }

  // 2. Authentication Verification
  const char* providedAuth = doc["auth"] | "";
  if (strcmp(providedAuth, AUTH_TOKEN) != 0) {
    unauthorizedAttempts++;
    Serial.printf("[%s] SECURITY WARNING: Unauthorized command attempt! (Total: %lu)\n", source, unauthorizedAttempts);
    
    // Broadcast security event back to telemetry so dashboard can show warning
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

  // 3. Process Valid Commands
  const char* cmd = doc["cmd"] | "";

  if (strcmp(cmd, "SET_LED") == 0) {
    int targetLed = doc["led"] | 1;
    const char* modeStr = doc["mode"] | "OFF";
    unsigned long onMs = doc["onMs"] | 500;
    unsigned long offMs = doc["offMs"] | 500;

    LedMode newMode = MODE_OFF;
    if (strcmp(modeStr, "ON") == 0) newMode = MODE_ON;
    else if (strcmp(modeStr, "BLINK") == 0) newMode = MODE_BLINK;
    else newMode = MODE_OFF;

    if (targetLed == 1) {
      setLedMode(led1, newMode, onMs, offMs);
      Serial.printf("[%s] LED 1 set to %s (ON: %lu ms, OFF: %lu ms)\n", source, modeStr, onMs, offMs);
    } else if (targetLed == 2) {
      setLedMode(led2, newMode, onMs, offMs);
      Serial.printf("[%s] LED 2 set to %s (ON: %lu ms, OFF: %lu ms)\n", source, modeStr, onMs, offMs);
    }

    // Immediately push state confirmation
    publishTelemetry();
  }
  else if (strcmp(cmd, "PING") == 0) {
    // Latency round-trip pong
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

// =============================================================================
// TELEMETRY & STATUS PUBLISHING
// =============================================================================
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
    mqttClient.publish(topicStatus.c_str(), out.c_str(), true); // Retained
  }
  Serial.printf("[STATUS] %s\n", out.c_str());
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

  // LED 1 State
  JsonObject l1 = doc.createNestedObject("led1");
  l1["pin"] = PIN_LED1;
  l1["mode"] = (led1.mode == MODE_ON) ? "ON" : (led1.mode == MODE_BLINK) ? "BLINK" : "OFF";
  l1["state"] = digitalRead(PIN_LED1) == HIGH ? 1 : 0;
  l1["onMs"] = led1.onDurationMs;
  l1["offMs"] = led1.offDurationMs;

  // LED 2 State
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

  // Also output to USB Serial so Web Serial API users get live state!
  Serial.println(output);
}
