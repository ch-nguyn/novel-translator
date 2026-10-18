"use client";

interface Props {
  textColor: string;
}

export default function ContactPanel({ textColor }: Props) {
  return (
    <div className="flex flex-col gap-5">
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
        className="w-full max-w-xs rounded-lg border self-center"
        style={{ borderColor: textColor + "20" }}
      />
    </div>
  );
}
