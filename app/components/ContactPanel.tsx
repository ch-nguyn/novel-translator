"use client";

interface Props {
  textColor: string;
}

export default function ContactPanel({ textColor }: Props) {
  return (
    <div
      className="mb-4 p-3 sm:p-4 rounded-lg border"
      style={{ borderColor: textColor + "20" }}
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm">
          Nếu đại ca có yêu cầu gì thì có thể liên hệ vào{" "}
          <a
            href="https://www.facebook.com/chiennh2010/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline cursor-pointer hover:opacity-70"
            style={{ color: "#3b82f6" }}
          >
            facebook
          </a>. Hoặc nếu đại ca giàu thì có thể donate cho tiểu đệ ^^ (Thật sự thừa tiền)
        </p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
            src="https://plain-apac-prod-public.komododecks.com/202605/08/hvz0koRVP9YlCUZFoRME/image.jpg"
          alt="Donate QR"
          className="max-w-xs rounded border self-start"
          style={{ borderColor: textColor + "20" }}
        />
      </div>
    </div>
  );
}
