// Type declarations for text.js utilities
export function escapeHtml(s: any): string;
export function debounce<T extends (...args: any[]) => any>(fn: T, ms?: number): T;
export function norm(v: any): string;
export function lower(v: any): string;
export function noSpace(v: any): string;
export function uniqueSorted(arr: any[], locale?: string): any[];