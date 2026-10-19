"use client";

export function PrintButton({ label = "Скачать PDF / распечатать" }: { label?: string }) {
  return (
    <button type="button" className="btn btn-primary print:hidden" onClick={() => window.print()}>
      {label}
    </button>
  );
}
