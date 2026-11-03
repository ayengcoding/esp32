# Communication Protocol & API Reference

This document provides the technical specification for communication between the **GitHub Pages static frontend** and the **ESP32 microcontroller**, explaining the security model, JSON message schemas, and network architecture.

---

## 1. Why HTTPS Restricts Direct HTTP Calls to ESP32

When your web dashboard is deployed to GitHub Pages, the browser serves it exclusively over **HTTPS**:

$$\text{Origin: } \mathbf{https://USERNAME.github.io}$$

If JavaScript running on an HTTPS page attempts to execute a standard HTTP `fetch()` or `XMLHttpRequest` to an ESP32 on your local area network (e.g., `http://192.168.1.145/led/on`):

```text
[Browser Console Error]
Mixed Content: The page at 'https://...' was loaded over HTTPS, but requested an
insecure XMLHttpRequest endpoint 'http://192.168.1.145/led/on'. This request has
been blocked; the content must be served over HTTPS.
```

Furthermore, modern browsers enforce **Private Network Access (PNA)**:
- Requests from a public domain (`github.io`) into a private IP subnet (`192.168.x.x`, `10.x.x.x`, `172.16.x.x`) require special preflight CORS headers (`Access-Control-Allow-Private-Network`).
- Even with headers, mixed content (HTTP from an HTTPS origin) is strictly forbidden and cannot be overridden by user scripts.
- Running an HTTPS server on an ESP32 requires SSL certificates. Browsers reject self-signed certificates on local IP addresses unless custom root certificate authorities are installed on every device (which fails on mobile browsers).

### The Solution: Secure WebSockets (WSS) + MQTT Relay
1. **GitHub Pages Web Client**: Connects outward to an authenticated, public, or private **WebSocket Secure (WSS)** broker on port `8884` (HiveMQ) or `8084` (EMQX) over TLS (`wss://`). Because this connection uses TLS, it adheres strictly to browser security standards and generates **zero mixed content errors**.
2. **ESP32 Client**: Connects outward to standard MQTT on port `1883` (or MQTTS on `8883`) via standard Wi-Fi. It never listens on a public port and requires **no router port forwarding or public IP exposure**.
3. **End-to-End Authentication**: Every payload carries an authentication token. Even if someone inspects the public broker, unauthorized messages are rejected by the ESP32 firmware.

---

## 2. MQTT Topic Architecture

Topics are namespaced using the format:

```text
esp32ctrl/v1/{DEVICE_ID}/{CHANNEL}
```

| Channel | Direction | QoS | Retain | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `cmd` | Browser $\rightarrow$ ESP32 | 1 | `false` | Commands dispatched from web dashboard (LED control, Ping) |
| `status` | ESP32 $\rightarrow$ Browser | 1 | `true` | Device online status, pong responses, and security alerts |
| `telemetry` | ESP32 $\rightarrow$ Browser | 0 | `false` | Periodic heartbeats, GPIO states, RSSI, and free heap |

---

## 3. Command Payloads (Browser to ESP32)

Commands are published as compact JSON strings to `esp32ctrl/v1/{DEVICE_ID}/cmd`.

### 3.1: Set LED Mode (ON / OFF / BLINK)

```json
{
  "auth": "secret_token_1234",
  "deviceId": "ESP32-LED-CTRL-01",
  "cmd": "SET_LED",
  "led": 1,
  "mode": "BLINK",
  "onMs": 250,
  "offMs": 750
}
```

#### Field Specifications:
- `auth` *(string, required)*: Must strictly match `AUTH_TOKEN` defined in ESP32 firmware.
- `deviceId` *(string, optional)*: Used for multi-device disambiguation.
- `cmd` *(string, required)*: Must be `"SET_LED"`.
- `led` *(integer, required)*: `1` for GPIO 13, `2` for GPIO 25.
- `mode` *(string, required)*: `"ON"`, `"OFF"`, or `"BLINK"`.
- `onMs` *(integer, required if mode is BLINK)*: Duration in milliseconds the LED remains HIGH ($10 \le \text{onMs} \le 10000$).
- `offMs` *(integer, required if mode is BLINK)*: Duration in milliseconds the LED remains LOW ($10 \le \text{offMs} \le 10000$).

### 3.2: Round-Trip Latency Ping

```json
{
  "auth": "secret_token_1234",
  "cmd": "PING",
  "nonce": 1742084561234
}
```

---

## 4. Telemetry & Heartbeat Payloads (ESP32 to Browser)

Published every 3 seconds to `esp32ctrl/v1/{DEVICE_ID}/telemetry`:

```json
{
  "deviceId": "ESP32-LED-CTRL-01",
  "online": true,
  "ip": "192.168.1.145",
  "ssid": "MyHomeNetwork",
  "rssi": -58,
  "freeHeap": 284192,
  "uptimeSec": 1420,
  "unauthorizedAttempts": 0,
  "led1": {
    "pin": 13,
    "mode": "BLINK",
    "state": 1,
    "onMs": 250,
    "offMs": 750
  },
  "led2": {
    "pin": 25,
    "mode": "ON",
    "state": 1,
    "onMs": 500,
    "offMs": 500
  }
}
```

---

## 5. Non-Blocking Timing Architecture (`millis()`)

Traditional Arduino code often uses `delay()`:

```cpp
// ❌ WRONG: Blocks all execution, halts Wi-Fi and MQTT processing!
digitalWrite(13, HIGH);
delay(500);
digitalWrite(13, LOW);
delay(500);
```

While `delay()` is running, the CPU cannot service Wi-Fi packets, cannot process MQTT messages, and cannot simultaneously blink a second LED at a different rate.

In this project, each LED operates as an independent state machine using timestamp arithmetic:

```cpp
// ✅ CORRECT: Non-blocking state machine using millis()
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
```

Because `updateLed()` returns immediately when the timer has not elapsed, the ESP32 can cycle through both LEDs, process incoming Serial messages, and service the MQTT event loop thousands of times per second.

### Frequency and Duty Cycle Formulas:
- **Total Period ($T$)**: $T = \text{onMs} + \text{offMs}$ (in milliseconds).
- **Frequency ($f$)**: $f = \frac{1000}{T} = \frac{1000}{\text{onMs} + \text{offMs}}\,\text{Hz}$.
- **Duty Cycle ($D$)**: $D = \frac{\text{onMs}}{T} \times 100\% = \frac{\text{onMs}}{\text{onMs} + \text{offMs}} \times 100\%$.
