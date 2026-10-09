# Team Randomizer - Chia bảng

Công cụ web đơn giản: nhập danh sách team, chọn số team/bảng, random rồi xuất Excel.

## Cấu trúc project

```
team-randomizer/
├── index.html   # giao diện
├── style.css    # style
├── script.js    # logic random + xuất excel (ExcelJS)
└── README.md
```

## Cách chạy

Mở trực tiếp `index.html` bằng trình duyệt là chạy được (không cần server, không cần cài npm).

Nếu dùng VS Code, khuyên cài extension **Live Server** để có auto-reload khi sửa code:
1. Cài extension "Live Server" (Ritwick Dey)
2. Chuột phải vào `index.html` → "Open with Live Server"

## Ý tưởng làm thêm

- Cho chọn số bảng cố định thay vì số team/bảng (tự tính team/bảng)
- Kiểm tra + báo trùng tên team trước khi random
- Lưu lịch sử các lần random để so sánh
- Cho phép seed random để tái tạo lại 1 kết quả cụ thể
- Xuất thêm sheet lịch thi đấu (vòng tròn) từ các bảng đã chia
- Kéo-thả để chỉnh tay team giữa các bảng sau khi random
- Import từ file Excel/CSV có sẵn thay vì gõ tay danh sách

## Thư viện dùng

- [ExcelJS](https://github.com/exceljs/exceljs) (qua CDN) để tạo file `.xlsx` có định dạng: merge cột BẢNG, viền, tô màu tiêu đề.
