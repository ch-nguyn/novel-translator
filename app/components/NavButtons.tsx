"use client";

interface Props {
  prevUrl: string | null;
  nextUrl: string | null;
  disabled: boolean;
  textColor: string;
  prevLabel: string;
  nextLabel: string;
  onNavigate: (url: string) => void;
}

export default function NavButtons({
  prevUrl,
  nextUrl,
  disabled,
  textColor,
  prevLabel,
  nextLabel,
  onNavigate,
}: Props) {
  return (
    <div className="flex justify-between py-3">
      <button
        onClick={() => prevUrl && onNavigate(prevUrl)}
        disabled={!prevUrl || disabled}
        className="panel-btn px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium border transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
        style={{ borderColor: textColor + "30", color: textColor }}
      >
        ← {prevLabel}
      </button>
      <button
        onClick={() => nextUrl && onNavigate(nextUrl)}
        disabled={!nextUrl || disabled}
        className="panel-btn px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium border transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
        style={{ borderColor: textColor + "30", color: textColor }}
      >
        {nextLabel} →
      </button>
    </div>
  );
}
