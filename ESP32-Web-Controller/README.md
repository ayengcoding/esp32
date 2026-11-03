# ESP32 Web Controller (Dual LED Dashboard)

A secure, static, **GitHub Pages-deployable** web dashboard for real-time control and telemetry monitoring of an **ESP32-WROOM-32** dual-LED circuit (GPIO 13 and GPIO 25).

Designed to run seamlessly from any static web host without requiring a custom Node.js backend server, paid cloud subscriptions, or router port forwarding.

---

## Features

- **GitHub Pages Ready**: 100% static client-side architecture with relative asset links. Deployable directly to `https://USERNAME.github.io/ESP32-Web-Controller/`.
- **Zero Mixed-Content Errors**: Solves the browser HTTPS-to-HTTP mixed content and Private Network Access (PNA) restrictions using Secure WebSockets (`wss://`) over an encrypted MQTT broker.
- **Dual-Mode Connectivity**:
  - **Wireless (WSS MQTT)**: Controls your ESP32 from anywhere (desktop or smartphone) with sub-150ms latency.
  - **Direct USB (Web Serial API)**: Zero-setup local control in Chrome/Edge directly over a USB cable without Wi-Fi.
- **Independent Dual-LED Control**:
  - Independent ON / OFF / Blinking controls for **LED 1 (GPIO 13)** and **LED 2 (GPIO 25)**.
  - Configurable ON duration and OFF duration ($10\,\text{ms} - 10,000\,\text{ms}$).
  - Real-time frequency ($\text{Hz}$) and duty cycle ($\%$) computation.
- **Digital Waveform Oscilloscope**: Real-time canvas visualization of digital logic levels ($0\,\text{V} / 3.3\,\text{V}$) for both GPIO channels.
- **Hardware Telemetry & Metrics**:
  - Wi-Fi connection state, SSID, and live RSSI ($\text{dBm}$) signal meter.
  - Device local IP address assignment.
  - ESP32 Free Heap memory (bytes) and continuous uptime tracking.
  - Round-trip ping latency ($\text{ms}$).
- **Security & Pairing**:
  - Device ID + Secret Pairing Token validation on the ESP32.
  - Zero private credentials stored in public GitHub repositories.
  - Rejection of unauthorized commands with security counters.
- **Responsive Dark/Light Interface**: WCAG AA compliant with persistent local theme preference.

---

## Hardware Configuration

- **Microcontroller**: ESP32-WROOM-32 (NodeMCU / DevKit v1)
- **Breakout**: Purple ESP32 Expansion Board
- **LED 1**: Connected to **GPIO 13** through a $220\,\Omega$ resistor to GND
- **LED 2**: Connected to **GPIO 25** through a $220\,\Omega$ resistor to GND

---

## Directory Structure

```text
ESP32-Web-Controller/
├── index.html              # Static HTML5 application entry point
├── style.css               # Responsive CSS3 stylesheet (dark/light theme)
├── script.js               # Controller logic (MQTT over WSS, WebSerial, Waveform)
├── firmware/
│   └── esp32_controller.ino # ESP32 C++ non-blocking millis() firmware
├── docs/
│   ├── wiring.md           # Pinout, schematic, and resistor calculations
│   ├── setup.md            # GitHub Pages deployment & Arduino IDE guide
│   └── api.md              # JSON command schema and protocol specification
└── README.md
```

---

## Quick Start

1. **Deploy Frontend**:
   - Push this repository to GitHub as `ESP32-Web-Controller`.
   - Go to **Settings > Pages** and set source to `Deploy from a branch` (`main / root`).
   - Open your site: `https://USERNAME.github.io/ESP32-Web-Controller/`.

2. **Flash ESP32 Firmware**:
   - Open `firmware/esp32_controller.ino` in Arduino IDE.
   - Enter your Wi-Fi SSID, Password, and a secure `AUTH_TOKEN`.
   - Select **ESP32 Dev Module** and upload.

3. **Pair & Control**:
   - In the web dashboard, open the **Pairing Dialog**.
   - Enter the matching `DEVICE_ID` and `AUTH_TOKEN`.
   - Click **Save & Connect**. Your LEDs will respond immediately!

---

## Documentation Links

- [Hardware Wiring & Schematics](docs/wiring.md)
- [Complete Setup & Deployment Guide](docs/setup.md)
- [API Protocol & Non-blocking Millis Explanation](docs/api.md)

---

## License

MIT License. Free for educational and personal use.
