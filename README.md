# Cổng quản lý code tên Free Fire

Website Node.js thuần để đội thi đấu chọn custom, gửi/cập nhật danh sách người chơi và để BTC quản lý, nhập hàng loạt, xuất `PlayerNameOverwrite.json`.

## Chạy dự án

Yêu cầu Node.js 18 trở lên.

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

`config.json` chứa tên website, số slot, giới hạn thành viên và màu mặc định. Bốn custom `HV`, `MP`, `XN`, `YN` được tạo tự động ở lần chạy đầu tiên; BTC có thể thêm/xóa/khóa custom trên bảng điều khiển.

## Dữ liệu

- `data/customs.json`: custom, màu và trạng thái khóa.
- `data/submissions.json`: team, player, trạng thái lưu và edit token.
- `data/backups/`: bản sao tự động trước thao tác xóa.

Mọi lần ghi dùng file tạm rồi rename và được xếp hàng tuần tự. Lớp lưu trữ có thể đổi thư mục qua biến `DATA_DIR`.

Trên Render hoặc nền tảng có filesystem tạm, hãy gắn Persistent Disk và đặt `DATA_DIR` vào đường dẫn của disk. Khi cần nhiều instance, nên chuyển lớp lưu trữ sang PostgreSQL để khóa giao dịch và lưu bền vững.

## API chính

Public: `/api/customs`, `/api/customs/:id`, `/api/submissions`, `/api/submissions/:editToken`.

Admin: đăng nhập tại `/api/admin/login`; các API còn lại dùng session cookie HttpOnly, không lưu mật khẩu ở frontend. Bảng BTC hỗ trợ CRUD custom/team, import nhiều team và export theo custom hoặc toàn bộ.

## Nguồn dữ liệu export

Mỗi lần BTC tải `PlayerNameOverwrite.json`, backend chờ các thao tác ghi đang chạy hoàn tất rồi đọc mới `data/submissions.json` và `data/customs.json`. File được tạo trong bộ nhớ và trả trực tiếp với `Cache-Control: no-store`; không có file mẫu hoặc mảng dữ liệu export viết cứng.

Team gửi hoặc cập nhật code tên được tự động lưu với trạng thái `approved`, không cần BTC duyệt thủ công, và được đưa vào lần export kế tiếp. API sẽ chặn tải khi PlayerID không hợp lệ, vượt `Number.MAX_SAFE_INTEGER` hoặc thuộc nhiều team. Trang BTC hiển thị thời gian đồng bộ, số team/player, số xung đột và bản xem trước dữ liệu.

Định dạng game chỉ có 15 `TeamID`, vì vậy `export-all` chỉ tạo file khi dữ liệu đã lưu thuộc đúng một custom. Nếu có nhiều custom, BTC phải chọn từng custom để tránh tạo `TeamID` trùng trong cùng file.
