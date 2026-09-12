#include <Adafruit_SHT31.h>
#include <Adafruit_MPR121.h>

Adafruit_SHT31 sht31;
Adafruit_MPR121 touch;

constexpr float TEMP_LIMIT_C = 28.0;  // Change this temperature to suit your project.
constexpr float TEMP_OFFSET_C = 0.0;  // Calibrate after comparing with a trusted thermometer.
constexpr uint8_t LOUDNESS_PIN = A0;  // Grove Base Shield analog port A0.
constexpr uint8_t TOUCH_ADDRESS = 0x5B;

bool sht31Ready;
bool touchReady;

void setup() {
  Serial.begin(115200);
  pinMode(LED_BUILTIN, OUTPUT);

  sht31Ready = sht31.begin(0x44);  // Use 0x45 if the sensor's ADDR pin is HIGH.
  if (!sht31Ready) {
    Serial.println("SHT31 not found. Check power and I2C wiring.");
  }

  touchReady = touch.begin(TOUCH_ADDRESS);
  if (!touchReady) {
    Serial.println("Touch sensor not found. Check I2C wiring.");
  }
}

void loop() {
  const int loudness = analogRead(LOUDNESS_PIN);  // Higher values mean more sound.

  Serial.print("Loudness: ");
  Serial.print(loudness);

  if (sht31Ready) {
    const float temperatureC = sht31.readTemperature() + TEMP_OFFSET_C;
    const float humidity = sht31.readHumidity();

    if (isnan(temperatureC) || isnan(humidity)) {
      Serial.print(" | SHT31 read failed");
    } else {
      Serial.print(" | Temperature: ");
      Serial.print(temperatureC, 1);
      Serial.print(" C | Humidity: ");
      Serial.print(humidity, 1);
      Serial.print(" %");
      digitalWrite(LED_BUILTIN, temperatureC >= TEMP_LIMIT_C);
    }
  } else {
    Serial.print(" | SHT31 unavailable");
  }

  Serial.print(" | Touch: ");
  if (!touchReady) {
    Serial.print("unavailable");
  } else {
    const uint16_t touched = touch.touched();
    if (touched == 0) {
      Serial.print("none");
    } else {
      for (uint8_t key = 0; key < 12; ++key) {
        if (touched & (1 << key)) {
          Serial.print(key);
          Serial.print(' ');
        }
      }
    }
  }

  Serial.println();

  delay(1000);
}
