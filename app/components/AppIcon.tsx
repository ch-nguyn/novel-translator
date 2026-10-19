// The app's icon, drawn for next/og (app/icon.tsx, app/apple-icon.tsx,
// app/pwa-icon): an open book on the reader's sepia. `padding`: the share of
// the size left around the book.
export default function AppIcon({ size, padding }: { size: number; padding: number }) {
  const book = size * (1 - 2 * padding);
  return (
    <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", background: "#f5f5dc" }}>
      <svg width={book} height={book} viewBox="0 0 64 64">
        <path d="M6 14c8-3 17-3 26 3v37c-9-6-18-6-26-3z" fill="#3b82f6" />
        <path d="M58 14c-8-3-17-3-26 3v37c9-6 18-6 26-3z" fill="#2563eb" />
        <path d="M12 23c5-1 10-0.5 15 2M12 31c5-1 10-0.5 15 2M12 39c5-1 10-0.5 15 2" stroke="#f5f5dc" strokeWidth="2.5" strokeLinecap="round" fill="none" />
        <path d="M52 23c-5-1-10-0.5-15 2M52 31c-5-1-10-0.5-15 2M52 39c-5-1-10-0.5-15 2" stroke="#f5f5dc" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      </svg>
    </div>
  );
}
