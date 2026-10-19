import type { Metadata } from "next";
import LegalPage from "../components/LegalPage";

export const metadata: Metadata = { title: "Chính sách quyền riêng tư · Novel Translator" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Chính sách quyền riêng tư" updated="19/10/2026">
      <p className="mt-6">
        Novel Translator giúp bạn đọc truyện tiếng Trung bằng tiếng Việt. Trang này nói rõ ứng dụng lưu những gì và dùng vào việc gì.
      </p>

      <h2>Khi đăng nhập bằng Google</h2>
      <p>Đăng nhập là không bắt buộc. Nếu bạn đăng nhập, ứng dụng chỉ nhận từ Google:</p>
      <ul>
        <li>tên, địa chỉ email và ảnh đại diện của bạn.</li>
      </ul>
      <p>
        Những thông tin này được lưu trong cơ sở dữ liệu của ứng dụng để nhận ra tài khoản của bạn, và sau này để quản lý gói dịch vụ bạn mua.
        Ứng dụng không đọc email, danh bạ, Drive hay bất kỳ dữ liệu nào khác trong tài khoản Google của bạn.
      </p>

      <h2>Dữ liệu lưu trên máy của bạn</h2>
      <p>
        Thư viện truyện, các chương đã dịch và bảng tên riêng nằm trong bộ nhớ trình duyệt trên máy của bạn.
        Các chương đã dịch chỉ được lưu trên máy của bạn; máy chủ chỉ giữ tạm những chương đang dịch nền (xem bên dưới).
        Xóa dữ liệu trang web trong trình duyệt là xóa hết những thứ này trên máy đó.
      </p>

      <h2>Khi đã đăng nhập</h2>
      <p>
        Khi bạn đăng nhập, cài đặt của bạn (model AI, prompt, cỡ chữ, màu nền, cách đọc to...) và API key bạn nhập được lưu vào tài khoản
        để dùng được trên mọi thiết bị. API key được mã hóa trước khi lưu và chỉ được giải mã khi gửi lại cho chính bạn.
        Khi chưa đăng nhập, những thứ này chỉ nằm trên máy của bạn.
      </p>
      <p>
        Khi đăng nhập, tủ truyện của bạn (tên truyện, chương và đoạn bạn đang đọc tới) và bảng tên riêng của từng truyện cũng được lưu vào tài khoản
        để đọc tiếp được trên thiết bị khác. Xóa một truyện khỏi tủ là xóa nó khỏi tài khoản và các thiết bị khác của bạn.
      </p>

      <h2>Khi dịch truyện</h2>
      <ul>
        <li>
          Nội dung chương và API key của bạn được gửi qua máy chủ của ứng dụng tới nhà cung cấp AI (OpenAI, Google, Anthropic, OpenRouter tùy model bạn chọn) để dịch.
          Máy chủ chỉ dùng API key cho lượt dịch đó.
        </li>
        <li>Khi bạn dùng gói tháng, nội dung chương được gửi tới dịch vụ AI của ứng dụng thay cho API key của bạn.</li>
        <li>
          Khi dịch chạy nền (dịch trước vài chương tiếp theo), chương đã dịch được giữ tạm trên máy chủ cho tới khi máy của bạn tải về, rồi xóa.
          Chương máy bạn không tải về bị xóa 7 ngày sau lần dịch nền gần nhất của máy đó.
        </li>
        <li>Khi bạn nghe đọc to bằng giọng AI, đoạn văn đang đọc được gửi tới OpenAI bằng API key của bạn.</li>
        <li>Tên truyện và tên chương đã dịch được lưu đệm chung để lần sau dịch nhanh hơn. Phần này không gắn với bạn.</li>
      </ul>

      <h2>Địa chỉ IP</h2>
      <p>
        Để chặn việc gửi quá nhiều yêu cầu, máy chủ đếm số lượt tải chương và tìm truyện theo địa chỉ IP của bạn.
        Số đếm này tự xóa sau vài phút và không gắn với tài khoản của bạn.
      </p>

      <h2>Khi mua gói tháng</h2>
      <p>
        Gói tháng được thanh toán bằng chuyển khoản ngân hàng; SePay báo cho ứng dụng khi tiền về. Ứng dụng lưu số tiền, nội dung chuyển khoản,
        mã giao dịch và thời hạn gói của bạn để kích hoạt và gia hạn gói. Ứng dụng không nhận hay lưu thông tin thẻ hay tài khoản ngân hàng của bạn.
      </p>

      <h2>Chia sẻ dữ liệu</h2>
      <p>
        Ứng dụng không bán hay chia sẻ thông tin của bạn cho bên nào khác, ngoài các nhà cung cấp dịch vụ cần để ứng dụng chạy:
        Vercel (máy chủ), Neon (cơ sở dữ liệu), Upstash (bộ nhớ đệm), SePay (thanh toán) và nhà cung cấp AI.
      </p>

      <h2>Xóa tài khoản</h2>
      <p>
        Bạn có thể yêu cầu xóa tài khoản và mọi thông tin gắn với nó qua mục Liên hệ trong ứng dụng.
        Bạn cũng có thể gỡ quyền truy cập của ứng dụng bất cứ lúc nào tại myaccount.google.com/permissions.
      </p>
    </LegalPage>
  );
}
