# WAVE Music — Node.js MVC + EJS + MySQL

Website đồ án nghe nhạc, quản lý playlist cá nhân và đăng ký VIP (thanh toán mô phỏng). Thiết kế dùng **9 bảng nghiệp vụ** trong phạm vi hiện tại: `NguoiDung`, `BaiHat`, `CaSi`, `TheLoai`, `Album`, `Playlist`, `ChiTietPlaylist`, `GoiVIP`, `DangKyVIP`.

## 1. Yêu cầu

- Node.js >= 20 (Windows dùng `npm.cmd` trong PowerShell để tránh lỗi execution policy).
- MySQL Server 8.0.16+ **đang chạy** (MySQL Workbench hoặc phpMyAdmin chỉ là công cụ quản lý; không bắt buộc cài XAMPP).
- Tài khoản MySQL có quyền tạo database/bảng; nếu `root` có mật khẩu thì nhập đúng vào `.env`.

## 2. Khởi tạo (Windows, PowerShell hoặc CMD)

```bat
cd C:\duong-dan\wave-music-mvc
npm.cmd install
npm.cmd run setup
```

Mở file `.env` vừa được tạo, sửa `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT` theo máy bạn. Mặc định `DB_NAME=wave_music_mvc`. Lệnh setup tự tạo `SESSION_SECRET` ngẫu nhiên dài 64 ký tự và không ghi đè `.env` cũ. **Không đưa `.env` lên GitHub.**

## 3. Tạo/cập nhật 10 bảng trong MySQL

**Database mới:** MySQL Workbench → File → Open SQL Script → chọn `database/schema.sql` → Execute. File tạo database `wave_music_mvc` và đúng 10 bảng nghiệp vụ.

**Database cũ đang có `BaiHat.LoaiBaiHat`:** sao lưu database rồi chạy `database/migrate_admin_feedback.sql` **một lần**. Script chuyển dữ liệu FREE/VIP sang `IsVIP`, thêm `TrangThai` cho Soft Delete và bỏ cột `LoaiBaiHat`. Không chạy migration này trên database đã được cập nhật.

Sau cập nhật, `BaiHat` dùng `IsVIP` (`0=FREE`, `1=VIP`) và `TrangThai` (`1=hoạt động`, `0=khóa/ẩn`).

## 4. Thêm dữ liệu và tạo admin

```bat
npm.cmd run db:seed
```

Lệnh tạo 3 ca sĩ, 4 thể loại, 1 album, 6 bài hát (4 FREE, 2 VIP), 3 gói VIP. 6 tệp WAV giai điệu demo **tự tạo bằng mã nguồn**, dài khoảng 16 giây/tệp. Dữ liệu demo không dùng bài hát thương mại; thay bằng file nhạc bạn có quyền sử dụng qua Admin. Có thể chạy lại seed mà không thêm trùng các mục demo.

Trong `.env`, đặt mật khẩu mạnh 12+ ký tự, ví dụ tự chọn `ADMIN_PASSWORD=...`. Giữ `ADMIN_EMAIL=admin@wave.local` hoặc sửa email. Sau đó:

```bat
npm.cmd run create-admin
npm.cmd run dev
```

Mở **http://localhost:3000**. Muốn chạy không watch: `npm.cmd start`. Nếu trùng email Admin, script **không** âm thầm nâng quyền tài khoản đã tồn tại; đổi `ADMIN_EMAIL` sang email khác để tạo.

## 5. Kiểm tra 5 chức năng cốt lõi

1. **Tài khoản**: `/register`, `/login`, đăng xuất. Mật khẩu băm BCrypt, session, role USER/ADMIN, CSRF form.
2. **Nghe nhạc**: `/`, `/songs` tìm tên/ca sĩ và lọc thể loại; `/songs/:id`; `<audio>` hỗ trợ Range qua endpoint `/songs/:id/stream`. Bộ seed có WAV thật để nghe thử.
3. **Playlist**: đăng nhập → `/playlists` → tạo playlist; vào chi tiết bài hát `/songs/:id`, nhấn **+ Thêm vào playlist** để chọn playlist; trong trang playlist có đổi tên/xóa bài hát/xóa playlist. Controller/SQL xác minh `MaNguoiDung` là chủ sở hữu.
4. **VIP**: `/vip` → gửi đăng ký chờ xác nhận, **không thu tiền thật** → Admin duyệt ở `/admin#vip` → tài khoản nghe được nhạc VIP tới `NgayKetThuc`. API stream kiểm tra quyền ở server; file VIP nằm ngoài `public`.
5. **Admin bài hát**: `/admin` → lọc bài hát Tất cả/VIP/Miễn phí ngay trong truy vấn MySQL, thêm/sửa/xóa và nút **Nghe thử** trên từng dòng; `/admin/music` là thư viện nghe kiểm tra FREE/VIP, `/admin/music/:id` là trang chi tiết. File nhạc Admin upload chỉ nhận **MP3/AAC** tối đa 25 MB; server kiểm tra định dạng và tự lấy `ThoiLuong`. Ảnh cover upload tùy chọn chỉ nhận **JPG/PNG**. Xóa bài hát là **Soft Delete** (`TrangThai=0`), dữ liệu vẫn còn trong MySQL. Admin có quyền duyệt đăng ký VIP mô phỏng.

## 6. MVC trong dự án

```text
routes/         → ánh xạ URL tới controller
controllers/    → xác thực dữ liệu, xử lý nghiệp vụ, quyết định quyền
models/         → truy vấn MySQL qua mysql2/promise
views/          → trang EJS, render thành HTML ở server
public/         → CSS, JS chạy trên trình duyệt, ảnh bìa minh họa
config/db.js    → pool MySQL từ .env
middleware/     → phiên đăng nhập, vai trò, CSRF
storage/audio/  → tệp âm thanh ngoài web root (truy cập qua kiểm tra quyền)
database/       → schema SQL đúng CP3
scripts/        → tạo .env, seed, tạo admin, kiểm tra cú pháp
```

**Luồng VIP**: Browser → `/songs/:id/stream` → SongController → SongModel lấy `BaiHat` → VIPModel kiểm tra `DangKyVIP` theo `MaNguoiDung`, trạng thái `DA_XAC_NHAN` và thời hạn → nếu hợp lệ stream tệp; nếu không trả HTTP 403. Không dựa vào màu nút VIP / flag phía trình duyệt. `TrangThaiVIP` là cờ hiển thị/cache, quyền phát lấy từ `DangKyVIP`.

## 7. Cập nhật theo nhận xét giảng viên

- `DuongDanAudio`: lưu tên/đường dẫn file nhạc đã upload.
- `IsVIP BOOLEAN`: `0` là FREE, `1` là VIP.
- `TrangThai BOOLEAN`: `1` đang hoạt động, `0` đã khóa/ẩn.
- `ThoiLuong`: không nhập tay khi upload mới; server tự đọc từ file MP3/AAC.
- Xóa bài hát chỉ cập nhật `TrangThai=0`, không `DELETE FROM BaiHat`.
- Danh sách, chi tiết, stream và thao tác thêm vào playlist của người dùng đều chỉ sử dụng bài có `TrangThai=1`.

## 7. Các lỗi hay gặp

- `Access denied for user 'root'@'localhost'`: `DB_PASSWORD`/`DB_USER` sai, chưa có MySQL server hoặc đang trỏ nhầm instance. Chỉnh `.env` rồi chạy lại.
- `Unknown database 'wave_music_mvc'`: chưa chạy `database/schema.sql`.
- `SESSION_SECRET phải có ít nhất 32 ký tự`: chạy `npm.cmd run setup` nếu chưa có `.env`; nếu `.env` cũ đã tồn tại, sửa `SESSION_SECRET` thành chuỗi ngẫu nhiên dài >=32 ký tự. `setup` không ghi đè file cũ.
- `npm.ps1 cannot be loaded`: dùng `npm.cmd ...` trong PowerShell hoặc CMD.
- `Cannot find module 'express'`: chạy `npm.cmd install` trong đúng thư mục có `package.json`.
- Trình phát báo không có file: kiểm tra đã chạy seed hoặc file vừa upload ở `storage/audio`.

## 8. Giới hạn bản đồ án

- `express-session` đang dùng **MemoryStore chỉ cho máy cá nhân/demo**; phiên mất khi restart, không phù hợp production. Khi triển khai thật thay persistent session store có quản lý phù hợp (nếu thêm bảng phiên, lưu riêng để không thay đổi 10 bảng nghiệp vụ của CP3).
- Thanh toán VIP chỉ **mô phỏng và cần Admin phê duyệt**. Không tích hợp cổng thanh toán thật.
- Không có upload/danh mục CRUD ca sĩ, album, thể loại ở bản đầu: seed các danh mục, quản lý CRUD bài hát trước.
- Không bao gồm bản quyền nhạc thương mại; chỉ dùng âm thanh demo gốc hoặc file đã được cấp quyền.
- Trên hosting cần HTTPS, quản lý bí mật, persistent sessions, sao lưu và giám sát. Không dùng `root` làm tài khoản DB production.

## Thay đổi giao diện (bản cập nhật)

- Trang playlist chỉ quản lý tên, xóa playlist và liệt kê/xóa bài hát. Không còn hộp chọn bài hát trong trang playlist.
- Vào **chi tiết bài hát** → **+ Thêm vào playlist** → chọn playlist cá nhân → xác nhận. Bài hát trùng được thông báo; SQL vẫn xác minh playlist thuộc người đang đăng nhập.
- Tài khoản ADMIN được chuyển tới `/admin`, chỉ có **Quản trị / Bài hát** ở thanh bên. Admin có trình phát để kiểm tra cả bài FREE và VIP (máy chủ xác minh vai trò ADMIN trước khi phát VIP). Trong Quản trị có nút **▶ Nghe thử** và bộ lọc GET `?type=ALL|VIP|FREE` tại truy vấn MySQL. Mục Bài hát `/admin/music` cho phép tìm kiếm/lọc/nghe nhạc; nhấn tên bài hát để xem chi tiết rồi bấm Sửa nếu cần.
- Cập nhật `BaiHat` theo nhận xét giảng viên: `IsVIP`, `TrangThai`, `ThoiLuong`, `DuongDanAudio`. Database cũ cần chạy `database/migrate_admin_feedback.sql` một lần.

## Bản cập nhật: Admin nghe thử và chuyển trang không ngắt nhạc

- `public/js/app.js` bắt sự kiện nhấp **liên kết nội bộ** và gửi biểu mẫu GET (tìm kiếm/lọc), lấy HTML EJS do máy chủ render rồi chỉ thay `<main>`. Sidebar và phần tử `<audio>` không bị tạo lại; bài hát, vị trí phát và âm lượng vẫn được giữ khi chuyển trang trong cùng tài khoản. Quay lại/tiến tới trình duyệt được hỗ trợ qua History API.
- Bắt sự kiện bằng cơ chế delegation, do đó nút ▶ trên các trang mới vẫn hoạt động. Playlist phát trước/tiếp theo dùng hàng đợi từ danh sách bài hát đã chọn, không mất hàng đợi khi đổi trang.
- **Giới hạn:** Đăng nhập/đăng xuất, gửi biểu mẫu POST hoặc tải lại trang bằng F5 là tải trang thật, nên nhạc có thể dừng. Nếu điều hướng AJAX thất bại, hệ thống tự chuyển trang theo cách truyền thống. Đây là cải tiến cho chuyển trang trong cùng phiên, không phải streaming xuyên suốt mọi phiên đăng nhập.
- `/songs/:id/stream` vẫn kiểm tra quyền VIP tại Back-end cho USER. ADMIN được cấp quyền nghe thử VIP mà không phải đăng ký gói VIP.
- **Cập nhật từ bản trước:** sao lưu folder, giải nén phiên bản mới và giữ nguyên `.env`, `storage/audio/upload-*`, database MySQL. Không cần import lại `schema.sql` hoặc seed lại; chạy `npm.cmd install` nếu chưa cài thư viện và `npm.cmd run dev`.

### Kiểm tra bản cập nhật không cần kết nối MySQL

Chạy `npm.cmd run test:updates`. Script dùng dữ liệu mô phỏng để kiểm tra truy vấn lọc VIP/FREE, quyền sở hữu playlist, thông báo khi thêm trùng, giao diện Admin nghe thử, quyền truy cập stream VIP và cú pháp của 14 EJS qua bộ kiểm tra đơn giản. Nó không ghi dữ liệu vào MySQL. Kiểm tra cú pháp EJS bằng thư viện EJS thực tế cần chạy `npm.cmd install` trước rồi `npm.cmd run check`.

## Luồng thanh toán VIP mô phỏng

Bản đồ án có thêm bước thanh toán mô phỏng trước khi gửi yêu cầu VIP:

1. Người dùng chọn gói tại `/vip`.
2. Hệ thống chuyển sang `/vip/payment` và hiển thị QR/tài khoản **demo**, không dùng thông tin ngân hàng thật.
3. Người dùng chọn chuyển khoản hoặc thẻ mô phỏng rồi bấm **Xác nhận đã thanh toán & hoàn tất**.
4. Lúc này hệ thống mới tạo `DangKyVIP` với trạng thái `CHO_XAC_NHAN`.
5. Admin vào `/admin#vip` để duyệt hoặc từ chối. Chỉ sau khi duyệt, quyền VIP mới có hiệu lực.

Không nhập số thẻ, CVV, OTP hoặc chuyển tiền thật vào màn hình demo.
