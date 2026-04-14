export const fmt = (n) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);

export const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const fmtDate = (d) => {
  const dt = new Date(d + "T00:00:00");
  const day = DAYS_SHORT[dt.getDay()];
  const rest = dt.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${day}, ${rest}`;
};

export const fmtTime = (t) => {
  if (!t) return null;
  const [h, m] = t.split(":");
  const hr = parseInt(h, 10);
  const suffix = hr >= 12 ? "PM" : "AM";
  const h12 = hr % 12 || 12;
  return `${h12}:${m} ${suffix}`;
};
