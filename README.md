# Digital Strom Smart for Homey Pro

Control your Digital Strom smart home from Homey Pro. Built by [Woon IoT BV](https://wooniot.nl).

## Features

### Free Tier
- **Lights** — Zone-based brightness control (on/off, dimming)
- **Covers** — Blinds and shades control (open, close, position)
- **Switches** — Individual Joker device control
- **Binary Sensors** — Door/window contacts, smoke detectors, motion sensors
- **Meters** — Power consumption (total + per circuit), zone temperatures
- **Scenes** — Activate dS scenes via Homey Flows

### Pro Tier (license required)
- **Climate** — Thermostat control for heating/cooling zones
- **Presence** — Apartment-wide presence modes (Present, Absent, Sleeping, etc.)
- **Weather** — Outdoor weather sensors (temperature, humidity, wind)
- **Alarms** — Alarm panels, panic, doorbell
- **Blink** — Identify devices (Flow action)
- **Save Scene** — Save current values as scene (Flow action)

## Setup

1. Install the app on your Homey Pro
2. Add a device → Digital Strom Smart
3. Enter your dSS IP address (e.g., `192.168.1.100`)
4. Approve the app token on your dSS (press the button or enter the code in dSS configurator)
5. Select the devices you want to add

### Pro License
Go to the app settings to enter your Pro license key. Purchase at [wooniot.nl/shop](https://wooniot.nl/shop).

## Requirements

- Homey Pro (2023 or later) with SDK 3
- Digital Strom Server (dSS) on the same network
- dSS firmware 1.14 or later recommended

## Flow Cards

### Actions
- **Activate a scene** — Call any dS scene by zone, group, and scene number
- **Blink a device** (Pro) — Identify a device by its dsUID
- **Save scene** (Pro) — Save current device values as a scene

## Supported Devices

| dS Group | Homey Driver | Capabilities |
|----------|-------------|--------------|
| Light (1) | digitalstrom-light | on/off, dim |
| Shade (2) | digitalstrom-cover | position, state |
| Joker (8) actuator | digitalstrom-switch | on/off |
| Joker (8) sensor | digitalstrom-sensor | alarm |
| Meters/Temp | digitalstrom-meter | power, temperature |
| Heating (3) | digitalstrom-climate (Pro) | target temp, current temp |
| Apartment | digitalstrom-presence (Pro) | presence mode |
| Outdoor | digitalstrom-weather (Pro) | temp, humidity, wind |
| Security (6) | digitalstrom-alarm (Pro) | alarm state, on/off |

## Architecture

```
app.js                    — Main app, session management, Flow cards
lib/
  dss-client.js           — dSS JSON API client (login, events, commands)
  coordinator.js          — Event-driven state management + polling
  license.js              — License validation (online + offline HMAC)
drivers/
  digitalstrom-light/     — Zone light control
  digitalstrom-cover/     — Zone cover/blind control
  digitalstrom-switch/    — Joker actuator control
  digitalstrom-sensor/    — Joker binary sensor
  digitalstrom-meter/     — Power + temperature meters
  digitalstrom-climate/   — Thermostat (Pro)
  digitalstrom-presence/  — Apartment presence (Pro)
  digitalstrom-weather/   — Outdoor sensors (Pro)
  digitalstrom-alarm/     — Alarm panels (Pro)
```

## Development

```bash
# Install dependencies
npm install

# Run on Homey (developer mode)
homey app run

# Deploy to Homey
homey app install
```

## License

GPL-3.0 — Copyright (c) 2026 Woon IoT BV
