"use client";

interface Props {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  textColor: string;
  // Shown under the label
  note?: string;
}

// An on/off setting: the whole row toggles it
export default function Switch({ label, checked, onChange, textColor, note }: Props) {
  return (
    <div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="w-full flex items-center justify-between gap-3 text-left cursor-pointer"
      >
        <span className="text-sm font-medium">{label}</span>
        <span
          className="relative w-11 h-6 rounded-full shrink-0 transition-colors duration-200"
          style={{ backgroundColor: checked ? "#3b82f6" : textColor + "20" }}
        >
          <span
            className="absolute top-0.5 left-0 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200"
            style={{ transform: checked ? "translateX(22px)" : "translateX(2px)" }}
          />
        </span>
      </button>
      {note && (
        <p className="text-xs mt-1" style={{ color: textColor + "80" }}>
          {note}
        </p>
      )}
    </div>
  );
}
