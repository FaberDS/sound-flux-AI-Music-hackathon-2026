#include <Adafruit_SHT31.h>

Adafruit_SHT31 sht31;

constexpr float TEMP_LIMIT_C = 28.0;  // Change this temperature to suit your project.
constexpr float TEMP_OFFSET_C = 0.0;  // Calibrate after comparing with a trusted thermometer.

void setup() {
  Serial.begin(115200);
  pinMode(LED_BUILTIN, OUTPUT);

  if (!sht31.begin(0x44)) {  // Use 0x45 if the sensor's ADDR pin is HIGH.
    Serial.println("SHT31 not found. Check power and I2C wiring.");
    while (true) delay(1);
  }
}

void loop() {
  const float temperatureC = sht31.readTemperature() + TEMP_OFFSET_C;
  const float humidity = sht31.readHumidity();

  if (isnan(temperatureC) || isnan(humidity)) {
    Serial.println("SHT31 read failed");
  } else {
    Serial.print("Temperature: ");
    Serial.print(temperatureC, 1);
    Serial.print(" C  Humidity: ");
    Serial.print(humidity, 1);
    Serial.println(" %");

    digitalWrite(LED_BUILTIN, temperatureC >= TEMP_LIMIT_C);
  }

  delay(1000);
}
