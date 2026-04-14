"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { signOut } from "next-auth/react";
import { Camera, Moon, Sun, LogOut, ChevronDown, Pencil } from "lucide-react";

export function UserMenu({ session, theme, onToggleTheme, isMobile }) {
  const [open, setOpen] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState(session?.user?.image || null);
  const [uploading, setUploading] = useState(false);
  const ref = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const handleAvatarUpload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("avatar", file);
      const res = await fetch("/api/avatar", { method: "POST", body: formData });
      const data = await res.json();
      if (data.avatar_url) setAvatarUrl(data.avatar_url);
      else if (data.error) console.error("Avatar upload failed:", data.error);
    } catch (err) {
      console.error("Avatar upload failed:", err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, []);

  const user = session?.user;

  return (
    <div ref={ref} className="relative">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleAvatarUpload}
      />
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="true"
        onKeyDown={(e) => { if (e.key === "Escape" && open) { setOpen(false); e.stopPropagation(); } }}
        className="flex items-center gap-2 py-1 pl-1 pr-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] cursor-pointer hover:bg-[var(--bg-hover)] transition-colors"
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="w-7 h-7 rounded-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          <div className="w-7 h-7 rounded-full bg-[var(--accent)] text-white flex items-center justify-center text-[13px] font-semibold">
            {user?.name?.[0]?.toUpperCase() || "?"}
          </div>
        )}
        {!isMobile && <span className="text-[13px] font-medium text-[var(--text)]">{user?.name?.split(" ")[0] || "User"}</span>}
        <ChevronDown size={12} className="text-[var(--text-secondary)] ml-0.5" />
      </button>

      {open && (
          <div
            className="absolute top-[calc(100%+6px)] right-0 min-w-[240px] bg-[var(--bg-card)] border border-[var(--border)] rounded-xl shadow-lg z-[100] overflow-hidden animate-[scaleIn_0.15s_ease] origin-top-right"
          >
            {/* Profile section */}
            <div className="px-4 pt-4 pb-3 border-b border-[var(--border)]">
              <div className="flex items-center gap-3">
                <div className="relative cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="" className="w-10 h-10 rounded-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-[var(--accent)] text-white flex items-center justify-center text-[17px] font-semibold">
                      {user?.name?.[0]?.toUpperCase() || "?"}
                    </div>
                  )}
                  <div className="absolute -bottom-0.5 -right-0.5 w-[18px] h-[18px] rounded-full bg-[var(--accent)] text-white flex items-center justify-center border-2 border-[var(--bg-card)]">
                    {uploading ? <span className="text-[8px]">...</span> : <Pencil size={8} />}
                  </div>
                </div>
                <div>
                  <div className="text-sm font-semibold text-[var(--text)]">{user?.name || "User"}</div>
                  <div className="text-xs text-[var(--text-secondary)]">{user?.email}</div>
                </div>
              </div>
            </div>

            {/* Menu items */}
            <div role="menu" onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }} className="p-1.5">
              <button
                role="menuitem"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-[var(--text)] text-[13px] text-left hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-50"
              >
                <Camera size={15} className="text-[var(--text-secondary)]" />
                {uploading ? "Uploading..." : "Change avatar"}
              </button>
              <button
                role="menuitem"
                onClick={onToggleTheme}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-[var(--text)] text-[13px] text-left hover:bg-[var(--bg-hover)] transition-colors"
              >
                {theme === "light" ? <Moon size={15} className="text-[var(--text-secondary)]" /> : <Sun size={15} className="text-[var(--text-secondary)]" />}
                {theme === "light" ? "Dark mode" : "Light mode"}
              </button>
              <button
                role="menuitem"
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-[var(--danger)] text-[13px] text-left hover:bg-[var(--bg-hover)] transition-colors"
              >
                <LogOut size={15} />
                Sign out
              </button>
            </div>
          </div>
        )}
    </div>
  );
}
