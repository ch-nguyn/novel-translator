import type { Metadata } from "next";
import LegalPage from "../components/LegalPage";

export const metadata: Metadata = { title: "Điều khoản sử dụng · Novel Translator" };

export default function TermsPage() {
  return (
    <LegalPage title="Điều khoản sử dụng" updated="18/10/2026">
      <p className="mt-6">Khi dùng Novel Translator, bạn đồng ý với các điều khoản dưới đây.</p>

      <h2>Ứng dụng làm gì</h2>
      <p>
        Ứng dụng lấy nội dung chương từ trang truyện bạn chọn và dịch sang tiếng Việt bằng AI, chỉ để bạn đọc riêng.
        Bản dịch do máy tạo ra nên có thể sai hoặc không sát nghĩa.
      </p>

      <h2>Trách nhiệm của bạn</h2>
      <ul>
        <li>Chỉ dùng bản dịch cho việc đọc cá nhân, không đăng lại hay bán nội dung truyện của người khác.</li>
        <li>Tự chịu chi phí phát sinh trên API key của chính bạn.</li>
        <li>Không dùng ứng dụng để gây quá tải cho ứng dụng hoặc cho các trang truyện.</li>
      </ul>

      <h2>Tài khoản và gói dịch vụ</h2>
      <p>
        Đăng nhập là không bắt buộc. Nếu sau này ứng dụng bán gói dịch vụ, mỗi gói sẽ ghi rõ giới hạn sử dụng và giá;
        tài khoản vi phạm điều khoản có thể bị khóa.
      </p>

      <h2>Không bảo đảm</h2>
      <p>
        Ứng dụng được cung cấp như hiện có. Các trang truyện và nhà cung cấp AI có thể thay đổi hoặc ngừng hoạt động bất cứ lúc nào,
        nên ứng dụng không bảo đảm luôn chạy được hay không có lỗi.
      </p>

      <h2>Thay đổi</h2>
      <p>Điều khoản có thể được cập nhật; ngày cập nhật ghi ở đầu trang.</p>
    </LegalPage>
  );
}
