// Layout of the privacy and terms pages
export default function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <main className="min-h-screen" style={{ backgroundColor: "#f5f5dc" }}>
      <article className="max-w-2xl mx-auto px-5 py-10 text-[15px] leading-relaxed [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-8 [&_h2]:mb-2 [&_li]:mb-1 [&_ul]:list-disc [&_ul]:pl-5">
        <a href="/" className="text-sm text-blue-600 hover:underline">← Novel Translator</a>
        <h1 className="text-2xl font-bold mt-4">{title}</h1>
        <p className="text-sm text-gray-500 mt-1">Cập nhật: {updated}</p>
        {children}
      </article>
    </main>
  );
}
