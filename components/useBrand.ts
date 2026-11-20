"use client";

import { useCallback, useEffect, useState } from "react";

// White-label settings for exported reports. Saved in this browser.

export interface Brand {
  /** Your agency / company name, shown at the top of the PDF. */
  name: string;
  /** Optional: the client the report is for ("Prepared for …"). */
  preparedFor: string;
  /** Accent colour for headings, rules and highlights. */
  accent: string;
  /** Logo as a data URL (downscaled on upload), or null. */
  logo: string | null;
  /** Footer line, e.g. "hello@agency.com · agency.com". */
  contact: string;
}

export const DEFAULT_BRAND: Brand = { name: "INTEL/01", preparedFor: "", accent: "#ff4f00", logo: null, contact: "" };
const KEY = "intel-brand";

export function isCustomBrand(b: Brand) {
  return b.name !== DEFAULT_BRAND.name || !!b.logo || !!b.preparedFor || !!b.contact || b.accent !== DEFAULT_BRAND.accent;
}

export function useBrand() {
  const [brand, setBrand] = useState<Brand>(DEFAULT_BRAND);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Brand> | null;
      if (saved) setBrand({ ...DEFAULT_BRAND, ...saved });
    } catch {
      // ignore broken settings
    }
  }, []);

  const save = useCallback((b: Brand) => {
    setBrand(b);
    try {
      localStorage.setItem(KEY, JSON.stringify(b));
    } catch {
      // storage full (large logo): keep for this session only
    }
  }, []);

  return { brand, save };
}

/** Reads an image file and downscales it to at most 480×160 so it stays small. */
export function readLogo(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpe?g|webp|svg\+xml|gif)$/.test(file.type)) return reject(new Error("Use a PNG, JPG, WebP, SVG or GIF image."));
    if (file.size > 5_000_000) return reject(new Error("That image is over 5 MB."));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Couldn't read that image."));
      img.onload = () => {
        const scale = Math.min(1, 480 / img.width, 160 / img.height);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/png"));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
