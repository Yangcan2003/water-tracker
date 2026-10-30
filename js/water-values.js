export function validWaterAmount(value) {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 10 && value <= 5000;
}
