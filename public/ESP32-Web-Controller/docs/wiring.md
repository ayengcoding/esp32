# ESP32 Hardware Wiring & Schematic Guide

This document describes how to connect two independently controlled LEDs to an **ESP32-WROOM-32** using the standard **Purple ESP32 Expansion Board** (38-pin or 30-pin dual-row breakout with screw terminals and power rails).

---

## 1. Bill of Materials (BOM)

| Component | Quantity | Specification / Description |
| :--- | :--- | :--- |
| **Microcontroller** | 1 | ESP32-WROOM-32 (NodeMCU / DevKit v1) |
| **Expansion Board** | 1 | Purple ESP32 Expansion Board (dual headers, DC barrel jack, power rails) |
| **LED 1 (Signal)** | 1 | 5mm or 3mm LED (Blue or Green recommended, $V_f \approx 2.1\text{V} - 3.0\text{V}$) |
| **LED 2 (Indicator)**| 1 | 5mm or 3mm LED (Red or Amber recommended, $V_f \approx 1.8\text{V} - 2.0\text{V}$) |
| **Current Resistors**| 2 | $220\,\Omega \pm 5\%$ carbon film or metal film resistor ($\frac{1}{4}\text{W}$) |
| **Breadboard / Jumper Wires** | 6 | Male-to-Male or Male-to-Female jumper wires |
| **Power Supply** | 1 | Micro-USB / USB-C cable or external 5V/2A DC power adapter |

---

## 2. Resistor Calculation (Ohm's Law)

ESP32 GPIO pins operate at **$3.3\,\text{V}$ logic levels**. Driving an LED directly without a current-limiting resistor will draw excessive current ($\gt 40\,\text{mA}$), risking permanent damage to the ESP32 silicon output stage.

$$\text{Resistance } R = \frac{V_{\text{GPIO}} - V_{\text{LED Forward}}}{I_{\text{Desired Forward}}}$$

For a Red LED with $V_f \approx 2.0\,\text{V}$ at a safe continuous $I_f = 6\,\text{mA}$:
$$R = \frac{3.3\,\text{V} - 2.0\,\text{V}}{0.006\,\text{A}} = \frac{1.3\,\text{V}}{0.006\,\text{A}} \approx 216\,\Omega \implies \mathbf{220\,\Omega\text{ (standard)}}$$

For a Blue/Green LED with $V_f \approx 2.8\,\text{V}$ at $I_f \approx 2.3\,\text{mA}$:
$$R = \frac{3.3\,\text{V} - 2.8\,\text{V}}{0.0023\,\text{A}} = \frac{0.5\,\text{V}}{0.0023\,\text{A}} \approx 217\,\Omega \implies \mathbf{220\,\Omega\text{ (standard)}}$$

$220\,\Omega$ is the ideal balanced value for both channels, keeping GPIO current well under the ESP32 recommended $12\,\text{mA}$ per-pin limit while ensuring high visibility.

---

## 3. Pin Connection Table

| Signal Source | Expansion Board Header | Resistor | Target Component | Return Path |
| :--- | :--- | :--- | :--- | :--- |
| **LED 1 Channel** | **GPIO 13** (D13) | $220\,\Omega$ (in series) | LED 1 Anode (Long Leg +) | LED 1 Cathode (Short Leg -) $\rightarrow$ **GND** |
| **LED 2 Channel** | **GPIO 25** (D25) | $220\,\Omega$ (in series) | LED 2 Anode (Long Leg +) | LED 2 Cathode (Short Leg -) $\rightarrow$ **GND** |

---

## 4. Purple Expansion Board Details

The purple expansion board breaks out all 30 or 38 pins of the ESP32 into 3-pin headers:
- **S (Signal)**: Connects directly to the ESP32 GPIO pin.
- **V (Voltage)**: Connected to either $3.3\,\text{V}$ or $5\,\text{V}$ depending on the jumper cap selector.
- **G (Ground)**: Common GND rail tied directly to the ESP32 ground plane.

### Recommended Jumper Setting
Locate the power selector jumper block on the purple board:
- Set the jumper to **$3.3\,\text{V}$** if using the onboard VCC pins for external logic.
- When wiring the LEDs directly to Signal pins (GPIO 13 and GPIO 25), the voltage is sourced directly from the ESP32 GPIO pin at $3.3\,\text{V}$. Connect the LED cathode return to any **GND** pin on the expansion board header.

---

## 5. Circuit Schematic (ASCII Diagram)

```text
       +-------------------------------------------------------+
       |                   ESP32-WROOM-32                      |
       |                                                       |
       |  [GPIO 13] --------[ 220 Ohm ]----->| (LED 1) ----+   |
       |                                     Anode  Cathode|   |
       |                                                   |   |
       |  [GPIO 25] --------[ 220 Ohm ]----->| (LED 2) ----+   |
       |                                     Anode  Cathode|   |
       |                                                   |   |
       |  [ GND ] <----------------------------------------+   |
       +-------------------------------------------------------+
```

---

## 6. Verification Steps Before Powering On

1. **LED Polarity Check**:
   - Anode (Longer leg / smaller internal triangle) connects to the $220\,\Omega$ resistor.
   - Cathode (Shorter leg / flat edge on plastic rim) connects to GND.
2. **Short Circuit Check**:
   - Verify with a multimeter in continuity mode that GPIO 13 and GPIO 25 have no accidental bridge to each other, to $3.3\,\text{V}$, or to GND.
3. **Powering Up**:
   - Plug the ESP32 into your computer via USB.
   - When the firmware boots, the power-on self-test briefly blinks both LEDs simultaneously for $150\,\text{ms}$ as a visual hardware confirmation that both channels are wired correctly.
