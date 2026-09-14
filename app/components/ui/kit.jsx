"use client";

import { useEffect, useRef } from "react";
import Icon from "./Icon";

/** A surface with an optional heading row. `flush` drops the padding for lists and tables. */
export function Card({ title, hint, action, flush, padLg, children, className = "", style, as: Tag = "section" }) {
  return (
    <Tag className={`card${flush ? " flush" : ""}${padLg ? " pad-lg" : ""} ${className}`} style={style}>
      {(title || action) && (
        <div className="card-head">
          {title && <h2>{title}</h2>}
          {hint && <span className="hint">{hint}</span>}
          {action && <span className="spacer">{action}</span>}
        </div>
      )}
      {children}
    </Tag>
  );
}

export function Button({ variant, size, icon, iconRight, children, className = "", block, ...rest }) {
  const cls = ["btn", variant, size, block && "block", !children && icon && "icon", className].filter(Boolean).join(" ");
  return (
    <button type="button" className={cls} {...rest}>
      {icon && <Icon name={icon} size={size === "sm" ? 14 : 16} />}
      {children}
      {iconRight && <Icon name={iconRight} size={14} />}
    </button>
  );
}

export function Chip({ tone, children, title }) {
  return <span className={`chip${tone ? ` ${tone}` : ""}`} title={title}>{children}</span>;
}

export function Segmented({ options, value, onChange, label }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? "on" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Kpi({ label, value, sub, large, tone, children }) {
  return (
    <div className="kpi">
      <span className="label">{label}</span>
      <span className={`v${large ? " lg" : ""}`} style={tone ? { color: tone } : undefined}>{value}</span>
      {sub && <span className="s">{sub}</span>}
      {children}
    </div>
  );
}

export function Banner({ tone, icon = "alert", title, children, action }) {
  return (
    <div className={`banner${tone ? ` ${tone}` : ""}`} role={tone === "bad" ? "alert" : undefined}>
      <Icon name={icon} size={18} />
      <div className="grow">
        <b>{title}</b>
        {children && <small>{children}</small>}
      </div>
      {action}
    </div>
  );
}

export function Empty({ icon = "file", title, children, action }) {
  return (
    <div className="empty">
      <div className="ico"><Icon name={icon} size={20} /></div>
      <b>{title}</b>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Field({ label, help, children, htmlFor }) {
  return (
    <label className="field" htmlFor={htmlFor}>
      <span>{label}</span>
      {children}
      {help && <span className="help">{help}</span>}
    </label>
  );
}

export function Notice({ msg }) {
  if (!msg?.text) return null;
  return (
    <div className="small" role="status" style={{ fontWeight: 600, color: msg.type === "error" ? "var(--danger)" : "var(--success)" }}>
      {msg.text}
    </div>
  );
}

/** Rounded monogram for a merchant, tinted by its category colour. */
export function MerchantAvatar({ name, color }) {
  const initials = (name || "?")
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase() || "?";
  return (
    <span className="merchant-avatar" style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}>
      {initials}
    </span>
  );
}

/** Dialog on desktop, bottom sheet on phones. Closes on Escape and backdrop click. */
export function Sheet({ open, onClose, title, subtitle, leading, wide, children, labelledBy = "sheet-title" }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    ref.current?.focus();
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="overlay" onClick={onClose}>
      <div
        ref={ref}
        className={`sheet${wide ? " wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="grabber" />
        <div className="sheet-head">
          {leading}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div id={labelledBy} style={{ fontWeight: 700, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
            {subtitle && <div className="small muted">{subtitle}</div>}
          </div>
          <Button variant="ghost" icon="x" aria-label="Close" onClick={onClose} />
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

/** Progress ring for a single share — receipt coverage, budget used. */
export function Ring({ pct, size = 96, stroke = 10, color = "var(--brand)", children }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct || 0));
  return (
    <div style={{ position: "relative", width: size, height: size, flex: "none" }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bg-card-2)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${(clamped / 100) * c} ${c}`}
          style={{ transition: "stroke-dasharray 0.4s ease" }}
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}>{children}</div>
    </div>
  );
}

/** Horizontal share bar with label and amount — categories, merchants, buckets. */
export function BarRow({ label, value, pct, color, right, onClick }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(80px, 128px) minmax(0, 1fr) auto",
        gap: 12,
        alignItems: "center",
        padding: "6px 0",
        width: "100%",
        background: "none",
        border: 0,
        textAlign: "left",
        fontSize: 13,
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: color || "var(--brand)", flex: "none" }} />
        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      </span>
      <span className="bar-track">
        <span className="bar-fill" style={{ display: "block", width: `${Math.max(1.5, pct)}%`, background: color || "var(--brand)" }} />
      </span>
      <span className="num" style={{ fontSize: 12.5, textAlign: "right", whiteSpace: "nowrap" }}>
        {value}
        {right}
      </span>
    </Tag>
  );
}
