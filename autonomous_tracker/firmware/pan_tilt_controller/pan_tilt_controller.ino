#include <Arduino.h>
#include <Servo.h>

constexpr uint8_t MAGIC_0 = 'P';
constexpr uint8_t MAGIC_1 = 'T';
constexpr uint8_t PROTOCOL_VERSION = 1;
constexpr uint8_t MSG_SET_ANGLES = 1;
constexpr uint8_t MSG_SET_VELOCITY = 2;
constexpr uint8_t MSG_STOP = 3;
constexpr uint8_t MSG_HOME = 4;
constexpr uint8_t MSG_PING = 5;
constexpr uint8_t MSG_ESTOP = 6;
constexpr uint8_t MSG_RESET_ESTOP = 7;
constexpr uint8_t MSG_STATE = 64;
constexpr uint8_t MSG_FAULT = 66;
constexpr uint8_t MSG_PONG = 67;
constexpr size_t MAX_PAYLOAD = 128;
constexpr uint32_t WATCHDOG_TIMEOUT_MS = 500;
constexpr uint32_t TELEMETRY_INTERVAL_MS = 50;

constexpr uint8_t PAN_SERVO_PIN = 9;
constexpr uint8_t TILT_SERVO_PIN = 10;
constexpr uint8_t ESTOP_PIN = 2;
constexpr uint8_t PAN_MIN_LIMIT_PIN = 3;
constexpr uint8_t PAN_MAX_LIMIT_PIN = 4;
constexpr uint8_t TILT_MIN_LIMIT_PIN = 5;
constexpr uint8_t TILT_MAX_LIMIT_PIN = 6;

constexpr float PAN_MIN_RAD = -1.5707963f;
constexpr float PAN_MAX_RAD = 1.5707963f;
constexpr float TILT_MIN_RAD = -0.3490659f;
constexpr float TILT_MAX_RAD = 1.3962634f;
constexpr float HOME_PAN_RAD = 0.0f;
constexpr float HOME_TILT_RAD = 0.0f;
constexpr float MAX_RATE_RADPS = 2.0f;

Servo panServo;
Servo tiltServo;
float panRad = HOME_PAN_RAD;
float tiltRad = HOME_TILT_RAD;
float panTargetRad = HOME_PAN_RAD;
float tiltTargetRad = HOME_TILT_RAD;
float panVelocityRadps = 0.0f;
float tiltVelocityRadps = 0.0f;
bool motionEnabled = false;
bool estopLatched = false;
bool homed = false;
uint32_t lastHeartbeatMs = 0;
uint32_t lastUpdateMs = 0;
uint32_t lastTelemetryMs = 0;

uint16_t crc16(const uint8_t* data, size_t length) {
  uint16_t crc = 0xFFFF;
  for (size_t i = 0; i < length; ++i) {
    crc ^= static_cast<uint16_t>(data[i]) << 8;
    for (uint8_t bit = 0; bit < 8; ++bit) {
      crc = (crc & 0x8000) ? static_cast<uint16_t>((crc << 1) ^ 0x1021) : static_cast<uint16_t>(crc << 1);
    }
  }
  return crc;
}

void disableMotion() {
  motionEnabled = false;
  panVelocityRadps = 0.0f;
  tiltVelocityRadps = 0.0f;
  panTargetRad = panRad;
  tiltTargetRad = tiltRad;
  panServo.detach();
  tiltServo.detach();
}

void enableMotion() {
  if (estopLatched || digitalRead(ESTOP_PIN) == LOW) return;
  if (!panServo.attached()) panServo.attach(PAN_SERVO_PIN);
  if (!tiltServo.attached()) tiltServo.attach(TILT_SERVO_PIN);
  motionEnabled = true;
}

float clampValue(float value, float minimum, float maximum) {
  return min(maximum, max(minimum, value));
}

int radiansToServo(float radians, float minimum, float maximum) {
  return static_cast<int>(180.0f * (radians - minimum) / (maximum - minimum));
}

void writeServos() {
  panServo.write(radiansToServo(panRad, PAN_MIN_RAD, PAN_MAX_RAD));
  tiltServo.write(radiansToServo(tiltRad, TILT_MIN_RAD, TILT_MAX_RAD));
}

void sendFrame(uint8_t type, uint16_t sequence, const uint8_t* payload, uint16_t length) {
  uint8_t frame[8 + MAX_PAYLOAD + 2];
  frame[0] = MAGIC_0;
  frame[1] = MAGIC_1;
  frame[2] = PROTOCOL_VERSION;
  frame[3] = type;
  memcpy(frame + 4, &sequence, 2);
  memcpy(frame + 6, &length, 2);
  if (length > 0) memcpy(frame + 8, payload, length);
  uint16_t crc = crc16(frame, 8 + length);
  memcpy(frame + 8 + length, &crc, 2);
  Serial.write(frame, 10 + length);
}

void sendState() {
  uint8_t payload[17];
  memcpy(payload, &panRad, 4);
  memcpy(payload + 4, &tiltRad, 4);
  memcpy(payload + 8, &panVelocityRadps, 4);
  memcpy(payload + 12, &tiltVelocityRadps, 4);
  payload[16] = (motionEnabled ? 0x01 : 0x00) | (homed ? 0x02 : 0x00) | (estopLatched ? 0x04 : 0x00);
  sendFrame(MSG_STATE, 0, payload, sizeof(payload));
}

void handleMessage(uint8_t type, uint16_t sequence, const uint8_t* payload, uint16_t length) {
  lastHeartbeatMs = millis();
  if (type == MSG_ESTOP) {
    estopLatched = true;
    disableMotion();
    return;
  }
  if (type == MSG_RESET_ESTOP) {
    if (digitalRead(ESTOP_PIN) == HIGH) estopLatched = false;
    disableMotion();
    return;
  }
  if (type == MSG_STOP) {
    disableMotion();
    return;
  }
  if (type == MSG_PING) {
    sendFrame(MSG_PONG, sequence, nullptr, 0);
    return;
  }
  if (estopLatched || digitalRead(ESTOP_PIN) == LOW) return;
  if (type == MSG_HOME) {
    enableMotion();
    panTargetRad = HOME_PAN_RAD;
    tiltTargetRad = HOME_TILT_RAD;
    homed = true;
    return;
  }
  if ((type == MSG_SET_ANGLES || type == MSG_SET_VELOCITY) && length == 8) {
    float first;
    float second;
    memcpy(&first, payload, 4);
    memcpy(&second, payload + 4, 4);
    if (!isfinite(first) || !isfinite(second)) return;
    enableMotion();
    homed = false;
    if (type == MSG_SET_ANGLES) {
      panTargetRad = clampValue(first, PAN_MIN_RAD, PAN_MAX_RAD);
      tiltTargetRad = clampValue(second, TILT_MIN_RAD, TILT_MAX_RAD);
      panVelocityRadps = 0.0f;
      tiltVelocityRadps = 0.0f;
    } else {
      panVelocityRadps = clampValue(first, -MAX_RATE_RADPS, MAX_RATE_RADPS);
      tiltVelocityRadps = clampValue(second, -MAX_RATE_RADPS, MAX_RATE_RADPS);
    }
  }
}

void readProtocol() {
  static uint8_t buffer[8 + MAX_PAYLOAD + 2];
  static size_t count = 0;
  while (Serial.available()) {
    uint8_t byteValue = static_cast<uint8_t>(Serial.read());
    if (count == 0 && byteValue != MAGIC_0) continue;
    if (count == 1 && byteValue != MAGIC_1) {
      count = byteValue == MAGIC_0 ? 1 : 0;
      continue;
    }
    buffer[count++] = byteValue;
    if (count < 8) continue;
    uint16_t payloadLength;
    memcpy(&payloadLength, buffer + 6, 2);
    if (buffer[2] != PROTOCOL_VERSION || payloadLength > MAX_PAYLOAD) {
      count = 0;
      continue;
    }
    size_t frameLength = 10 + payloadLength;
    if (count < frameLength) continue;
    uint16_t receivedCrc;
    memcpy(&receivedCrc, buffer + 8 + payloadLength, 2);
    if (crc16(buffer, 8 + payloadLength) == receivedCrc) {
      uint16_t sequence;
      memcpy(&sequence, buffer + 4, 2);
      handleMessage(buffer[3], sequence, buffer + 8, payloadLength);
    }
    count = 0;
  }
}

void updateMotion() {
  uint32_t now = millis();
  float dt = (now - lastUpdateMs) * 0.001f;
  lastUpdateMs = now;
  if (!motionEnabled || dt <= 0.0f) return;
  if (panVelocityRadps != 0.0f || tiltVelocityRadps != 0.0f) {
    panTargetRad = panRad + panVelocityRadps * dt;
    tiltTargetRad = tiltRad + tiltVelocityRadps * dt;
  }
  if ((digitalRead(PAN_MIN_LIMIT_PIN) == LOW && panTargetRad < panRad) ||
      (digitalRead(PAN_MAX_LIMIT_PIN) == LOW && panTargetRad > panRad)) panTargetRad = panRad;
  if ((digitalRead(TILT_MIN_LIMIT_PIN) == LOW && tiltTargetRad < tiltRad) ||
      (digitalRead(TILT_MAX_LIMIT_PIN) == LOW && tiltTargetRad > tiltRad)) tiltTargetRad = tiltRad;
  float maxStep = MAX_RATE_RADPS * dt;
  panRad += clampValue(panTargetRad - panRad, -maxStep, maxStep);
  tiltRad += clampValue(tiltTargetRad - tiltRad, -maxStep, maxStep);
  panRad = clampValue(panRad, PAN_MIN_RAD, PAN_MAX_RAD);
  tiltRad = clampValue(tiltRad, TILT_MIN_RAD, TILT_MAX_RAD);
  writeServos();
}

void setup() {
  Serial.begin(115200);
  pinMode(ESTOP_PIN, INPUT_PULLUP);
  pinMode(PAN_MIN_LIMIT_PIN, INPUT_PULLUP);
  pinMode(PAN_MAX_LIMIT_PIN, INPUT_PULLUP);
  pinMode(TILT_MIN_LIMIT_PIN, INPUT_PULLUP);
  pinMode(TILT_MAX_LIMIT_PIN, INPUT_PULLUP);
  lastHeartbeatMs = millis();
  lastUpdateMs = millis();
  disableMotion();
}

void loop() {
  readProtocol();
  if (digitalRead(ESTOP_PIN) == LOW) {
    estopLatched = true;
    disableMotion();
  }
  if (millis() - lastHeartbeatMs > WATCHDOG_TIMEOUT_MS) disableMotion();
  updateMotion();
  if (millis() - lastTelemetryMs >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryMs = millis();
    sendState();
  }
}

