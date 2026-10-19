import type { Metadata } from "next";
import LegalPage from "../components/LegalPage";

export const metadata: Metadata = { title: "Điều khoản sử dụng · Novel Translator" };

export default function TermsPage() {
  return (
    <LegalPage title="Điều khoản sử dụng" updated="19/10/2026">
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

      <h2>Tài khoản và gói tháng</h2>
      <p>
        Đăng nhập là không bắt buộc. Tài khoản đã đăng nhập có thể mua gói tháng: 49.000đ cho 30 ngày, dịch bằng AI của ứng dụng
        mà không cần API key và không giới hạn số chương, cho việc đọc cá nhân.
      </p>
      <ul>
        <li>Thanh toán bằng chuyển khoản ngân hàng với đúng nội dung chuyển khoản ứng dụng đưa ra; gói tự kích hoạt khi tiền về.</li>
        <li>Gói gồm việc dịch chương và tự động ghi nhớ tên riêng. Nghe truyện bằng giọng AI không thuộc gói và vẫn dùng OpenAI API key của bạn; giọng của máy vẫn miễn phí.</li>
        <li>Mỗi tài khoản dịch tối đa 4 chương cùng lúc.</li>
        <li>Mỗi 49.000đ trong một lần chuyển được cộng thêm 30 ngày. Gói không tự gia hạn.</li>
        <li>Chuyển sai nội dung hoặc thiếu tiền thì gói chưa kích hoạt; liên hệ qua mục Liên hệ để được xử lý.</li>
        <li>Gói dành cho một người dùng; chia sẻ tài khoản, dùng tự động hoặc gây quá tải có thể khiến tài khoản bị khóa.</li>
      </ul>

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
