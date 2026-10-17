# Cổng quản lý code tên Free Fire

Website Node.js thuần để đội thi đấu chọn custom, gửi/cập nhật danh sách người chơi và để BTC quản lý, nhập hàng loạt, xuất `PlayerNameOverwrite.json`.

## Chạy dự án

Yêu cầu Node.js 22 trở lên.

```powershell
npm install
$env:ADMIN_KEY="mat-khau-btc-an-toan"
npm start
```

- Trang chọn custom: `http://localhost:3000/`
- Form đội: `http://localhost:3000/custom/HV`
- Bảng BTC: `http://localhost:3000/admin`

Không dùng giá trị mặc định `change-me` khi triển khai thật.

## Cấu hình

`config.json` chứa tên website, số slot, giới hạn thành viên và màu mặc định. Bốn custom `HV`, `MP`, `XN`, `YN` được tạo tự động ở lần chạy đầu tiên; BTC có thể thêm/sửa/khóa custom trên bảng điều khiển.

## Dữ liệu Supabase

1. Mở Supabase SQL Editor, chạy toàn bộ [supabase/schema.sql](supabase/schema.sql).
2. Đặt các biến trong [.env.example](.env.example) vào cấu hình hosting: DATA_BACKEND=supabase, SUPABASE_URL, SUPABASE_SECRET_KEY và ADMIN_KEY. Chạy trên máy dùng .env.local, được Git bỏ qua. Biến môi trường hosting có ưu tiên cao nhất.
3. Chạy npm start. Lần đầu, nếu database chưa khởi tạo, server chuyển data/customs.json và data/submissions.json hiện có lên Supabase. Muốn chuyển dữ liệu đang chạy trên hosting cũ, cần dùng đúng hai file mới nhất của hosting đó trước lần khởi tạo này.
4. Những lần khởi động/deploy sau chỉ dùng dữ liệu trên Supabase, không ghi đè bằng file JSON trong repo.

Bảng scrim_state chứa custom và team/player dạng JSONB, giữ nguyên cấu trúc game và edit token. Mỗi yêu cầu đọc một snapshot. Mỗi lần ghi kiểm tra revision trong giao dịch PostgreSQL; nếu phiên khác vừa cập nhật, API trả 409 để người dùng tải lại, tránh ghi đè dữ liệu. Bảng scrim_backups giữ bản sao trước khi xóa team, migration.

Các bảng bật RLS, không cấp quyền cho anon/authenticated. Chỉ backend dùng secret key gọi RPC; không đưa secret vào frontend hoặc GitHub. Publishable key và JWKS URL chưa cần dùng vì đăng nhập BTC vẫn qua session cookie.

Khi lỗi kết nối, thiếu quyền hoặc thiếu schema, server báo lỗi và không tự quay về file JSON. DATA_BACKEND=json chỉ dành cho phát triển offline và kiểm thử; DATA_DIR chọn thư mục file như trước.

Custom đã thêm được giữ cố định, không cho xóa. Có thể khóa nhận, chỉnh sửa hoặc xóa từng team. Đã tắt reset tự động và thủ công; dữ liệu được giữ qua các ngày.

## API chính

Public: `/api/customs`, `/api/customs/:id`, `/api/submissions`, `/api/submissions/:editToken`.

Admin: đăng nhập tại `/api/admin/login`; các API còn lại dùng session cookie HttpOnly, không lưu mật khẩu ở frontend. Bảng BTC hỗ trợ thêm/sửa/khóa custom và quản lý team, import nhiều team và export theo custom hoặc toàn bộ.

## Nguồn dữ liệu export

Mỗi lần BTC tải `PlayerNameOverwrite.json`, backend chờ các thao tác ghi đang chạy hoàn tất rồi đọc snapshot mới từ Supabase (hoặc file JSON khi chạy offline). File được tạo trong bộ nhớ và trả trực tiếp với `Cache-Control: no-store`; không có file mẫu hoặc mảng dữ liệu export viết cứng.

Team gửi hoặc cập nhật code tên được tự động lưu với trạng thái `approved`, không cần BTC duyệt thủ công, và được đưa vào lần export kế tiếp. API sẽ chặn tải khi PlayerID không hợp lệ, vượt `Number.MAX_SAFE_INTEGER` hoặc thuộc nhiều team. Trang BTC hiển thị thời gian đồng bộ, số team/player, số xung đột và bản xem trước dữ liệu.

Định dạng game chỉ có 15 `TeamID`, vì vậy `export-all` chỉ tạo file khi dữ liệu đã lưu thuộc đúng một custom. Nếu có nhiều custom, BTC phải chọn từng custom để tránh tạo `TeamID` trùng trong cùng file.

Đã bỏ reset lúc 04:00 và chức năng RS hàng loạt. Team/player và custom được giữ đến khi BTC chỉnh sửa hoặc xóa từng team. Không cho phép xóa custom.

## Giao diện và kiểm tra

Giao diện chung nằm trong `public/ui.css` và `public/ui.js`, dùng cho trang chủ, đăng ký, BTC và logo. Trang chủ có tìm kiếm và lọc trạng thái custom; BTC tìm custom và team theo tên hoặc ID; form đội hỗ trợ sao chép mã chỉnh sửa. Animation tôn trọng tùy chọn giảm chuyển động của hệ điều hành.

Chạy `npm test` để kiểm tra xuất dữ liệu, reset và migration. Chạy `npm run test:ui` để kiểm tra desktop/mobile bằng Chrome hoặc Edge; đặt `UI_BROWSER` tới đường dẫn Chromium khi cần. Ảnh kiểm tra được lưu trong thư mục tạm, đường dẫn hiển thị sau khi chạy.

Custom MP được chuyển sang trắng `#FFFFFF` một lần khi nâng cấp (cờ `mpWhiteDefaultV2`). Những lần đổi màu sau đó của BTC được giữ nguyên qua các lần khởi động lại.

Giao diện dùng nền than đen, trắng giấy và điểm nhấn xanh chanh, tham khảo hướng thiết kế Room & Pillar. Hình khối ở trang chủ được dựng bằng canvas, tự dừng khi ra ngoài màn hình hoặc bật giảm chuyển động. Các đoạn giới thiệu và hướng dẫn dài đã được lược bỏ; thông báo lỗi, trạng thái và nhãn thao tác vẫn được giữ.

## Backup bảng logo và link nhận ảnh

Chạy thêm `supabase/logo-boards.sql` trong Supabase SQL Editor. Trong Logo Studio, nhập tên rồi bấm **Lưu backup bảng hiện tại**. Bản lưu giữ danh sách đội, ảnh gốc/ảnh chỉnh sửa, gán logo, custom xuất kèm và màu/ánh sáng viền. Sao chép link để đội chưa có logo gửi ảnh mà không cần đăng nhập BTC. Logo đã gán không thể bị người ngoài thay thế; hai lần gửi đồng thời vào cùng một đội chỉ nhận lần đầu.

Chọn bản lưu và bấm **Mở lại / nhận logo mới** để nạp các ảnh đã nhận vào Studio, rồi tiếp tục chỉnh sửa/xuất. Lưu backup tạo bản mới, không ghi đè bản cũ. Link tự mở khi còn đội dùng cờ Việt Nam mặc định, tự khóa ngay khi đủ logo. Không có nút đóng/mở thủ công. Tên bản lưu bắt buộc nhập và được hiển thị nguyên tên trong danh sách; mở bản cũ không ghi đè tên đang nhập. Người có link xem được tên đội và trạng thái có logo; không được xem ảnh trong backup hoặc dữ liệu quản trị.

Giới hạn mỗi bản: 200 đội, 400 logo, 100 MB; mỗi ảnh PNG đã xử lý tối đa 10 MB. Người gửi có thể chọn PNG/JPG/WebP dưới 10 MB; trình duyệt chuyển thành PNG tối đa 1000 px. Ảnh backup từ Studio được giữ tối đa 1600 px để phục vụ đầu ra 1000 px. Backup tự hết hạn sau 2 giờ kể từ lúc tạo; nhận thêm ảnh không gia hạn. Link dừng hoạt động ngay khi hết hạn; cron Supabase xóa ảnh và bản lưu mỗi phút, kể cả khi web ngủ. Chạy lại `supabase/logo-boards.sql` để cập nhật giới hạn và lịch dọn; dữ liệu custom/team không bị ảnh hưởng.
