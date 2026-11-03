# ESP32 Web Controller Deployment & Setup Guide

This guide walks you through deploying the static web dashboard to **GitHub Pages**, flashing the firmware using **Arduino IDE**, pairing your browser with your ESP32, and troubleshooting connections.

---

## Part 1: GitHub Pages Deployment (Free Static Hosting)

Because this dashboard is built with pure HTML5, CSS3, and JavaScript with relative asset paths, it requires zero build steps or server runtimes.

### Step 1.1: Create a New GitHub Repository
1. Log into your GitHub account at [github.com](https://github.com).
2. Click the **+** icon in the upper right and select **New repository**.
3. Name the repository `ESP32-Web-Controller`.
4. Choose **Public** (required for free GitHub Pages).
5. Check **Add a README file** (or leave unchecked if pushing existing files).
6. Click **Create repository**.

### Step 1.2: Upload Files
Upload or push the following directory structure to the `main` branch of your repository:

```text
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
```

You can upload files via Git CLI:
```bash
git clone https://github.com/USERNAME/ESP32-Web-Controller.git
cd ESP32-Web-Controller
# Copy index.html, style.css, script.js, firmware/, and docs/ into this folder
git add .
git commit -m "Initial release of ESP32 Web Controller"
git push origin main
```

### Step 1.3: Enable GitHub Pages
1. In your GitHub repository, click on the **Settings** tab.
2. In the left sidebar, click **Pages** (under the "Code and automation" section).
3. Under **Build and deployment**:
   - **Source**: Select `Deploy from a branch`.
   - **Branch**: Select `main` (or your default branch) and folder `/ (root)`.
4. Click **Save**.
5. Wait 1 to 2 minutes. GitHub Pages will display your public URL:
   `https://USERNAME.github.io/ESP32-Web-Controller/`

---

## Part 2: Arduino IDE & Firmware Installation

### Step 2.1: Install Arduino IDE
Download and install [Arduino IDE 2.x](https://www.arduino.cc/en/software) if you don't already have it installed.

### Step 2.2: Add ESP32 Board Package
1. Open Arduino IDE and go to **Settings / Preferences** (`Ctrl + ,` or `Cmd + ,`).
2. In **Additional boards manager URLs**, add:
   ```text
   https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
   ```
3. Open **Boards Manager** (left icon or `Tools > Board > Boards Manager`).
4. Search for `esp32` by **Espressif Systems** and click **Install**.

### Step 2.3: Install Required Libraries
Open **Library Manager** (`Tools > Manage Libraries...`) and install:
1. **PubSubClient** by Nick O'Leary (Version 2.8 or later).
2. **ArduinoJson** by Benoit Blanchon (Version 6.x or 7.x).

### Step 2.4: Configure Firmware Credentials
Open `firmware/esp32_controller.ino` in Arduino IDE. Update the top configuration section:

```cpp
// 1. Wi-Fi Credentials
const char* WIFI_SSID     = "MyHomeWiFi";       // Replace with your 2.4GHz Wi-Fi SSID
const char* WIFI_PASSWORD = "MySecretPassword";  // Replace with your Wi-Fi password

// 2. Device Pairing & Security Token
const char* DEVICE_ID     = "ESP32-WROOM-01";    // Choose any unique ID
const char* AUTH_TOKEN    = "my_secure_pin_987"; // Must match token entered in dashboard!
```

> **Security Warning**: Never commit your real Wi-Fi password or private auth token to a public GitHub repository. Keep your local `.ino` file private or add `firmware/credentials.h` to your `.gitignore`.

### Step 2.5: Flash Firmware to ESP32
1. Connect the ESP32 to your computer using a data-capable Micro-USB or USB-C cable.
2. Under `Tools > Board`, select **ESP32 Dev Module** (or **DOIT ESP32 DEVKIT V1**).
3. Under `Tools > Port`, select the active COM/Serial port.
4. Click **Upload** (`Ctrl + U` / `Cmd + U`).
   *(If the upload stalls at "Connecting...", press and hold the **BOOT** button on the ESP32 until the upload starts).*
5. Open the **Serial Monitor** at `115200 baud` to observe Wi-Fi connection and IP assignment.

---

## Part 3: Pairing & Testing Your Dashboard

### Step 3.1: Desktop Browser Pairing
1. Open your live GitHub Pages URL: `https://USERNAME.github.io/ESP32-Web-Controller/`.
2. Click the **Device Pairing / Key** button in the top navigation bar.
3. Enter:
   - **Device ID**: Exactly matches `DEVICE_ID` from firmware (e.g. `ESP32-WROOM-01`).
   - **Auth Token**: Exactly matches `AUTH_TOKEN` from firmware (e.g. `my_secure_pin_987`).
   - **MQTT Broker**: Leave at default (`broker.hivemq.com` WSS) unless using a custom broker.
4. Click **Save & Connect**.
5. Within 1–3 seconds, the connection indicator will transition to **ONLINE (Connected)**.
6. The dashboard will display:
   - Wi-Fi SSID and real RSSI signal strength (in dBm).
   - ESP32 local IP address.
   - Live round-trip ping time (latency).
   - Free memory (Heap) and device uptime.

### Step 3.2: Mobile Phone Testing
1. On your iPhone or Android phone, open Chrome or Safari.
2. Navigate to your GitHub Pages URL: `https://USERNAME.github.io/ESP32-Web-Controller/`.
3. Open the **Pairing Dialog**, enter the same `Device ID` and `Auth Token`, and tap **Save & Connect**.
4. Tap **LED 1 ON** or switch to **Blink Mode**:
   - The physical LED on your desk toggles in real time with low latency ($<150\,\text{ms}$) over Wi-Fi or cellular networks without needing port forwarding!

### Step 3.3: Web Serial API (Zero-Setup Direct USB Cable Control)
On desktop Chromium browsers (Chrome, Edge, Brave, Opera):
1. Plug your ESP32 directly into your computer via USB.
2. In the dashboard, click **Connect via USB (WebSerial)**.
3. Select your ESP32 COM port from the browser prompt.
4. Commands and real-time telemetry stream directly across the USB serial bridge!

---

## Part 4: Troubleshooting Guide

### Issue 1: Dashboard stays "OFFLINE"
- **Check ESP32 Serial Monitor**: Verify that the ESP32 output displays `[WiFi] Connected successfully!` and `[MQTT] Connected to broker!`.
- **Verify Device ID Match**: Device IDs are case-sensitive. `ESP32-01` does not match `esp32-01`.
- **Public Broker Outage**: Public test brokers can occasionally experience maintenance. In the pairing settings, toggle between `broker.hivemq.com` and `broker.emqx.io`.
- **2.4 GHz Wi-Fi**: ESP32 only supports 2.4 GHz Wi-Fi bands. Ensure your router does not restrict clients to 5 GHz only.

### Issue 2: "Security Alert: Unauthorized Command"
- The token entered in the web dashboard does not match `AUTH_TOKEN` in `esp32_controller.ino`.
- Open the Pairing modal in the dashboard and re-enter the correct token.

### Issue 3: LEDs do not light up on the physical board
- Check polarity: The longer lead of the LED must connect to the $220\,\Omega$ resistor, and the shorter lead must connect to **GND**.
- Test with the startup blink: Reset the ESP32 (press the EN/RST button). Both LEDs should flash once for $150\,\text{ms}$ on power-up. If they do not flash, verify the expansion board ground jumper.
