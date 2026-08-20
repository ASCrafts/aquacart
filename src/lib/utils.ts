import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** "₹1,200.00" for per-piece items, "₹750.00 / kg" for weight-only ones. */
export function formatPrice(product: { price: number; unit?: string | null }) {
  return `₹${product.price.toFixed(2)}${product.unit === 'kg' ? ' / kg' : ''}`
}
