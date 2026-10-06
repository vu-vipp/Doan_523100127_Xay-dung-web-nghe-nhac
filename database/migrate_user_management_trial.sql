-- Chạy MỘT LẦN trên database hiện tại để bổ sung quản lý người dùng.
-- Dùng cho MySQL 8.0.16+. Sao lưu database trước khi chạy.
USE wave_music_mvc;

ALTER TABLE NguoiDung
  ADD COLUMN TrangThai BOOLEAN NOT NULL DEFAULT TRUE AFTER TrangThaiVIP,
  ADD COLUMN LyDoKhoa VARCHAR(255) NULL AFTER TrangThai;

INSERT INTO GoiVIP (TenGoi, ThoiHan, Gia, MoTa)
SELECT 'Dùng thử VIP 1 ngày', 1, 0, 'VIP dùng thử miễn phí 1 ngày dành cho tài khoản mới.'
WHERE NOT EXISTS (
  SELECT 1 FROM GoiVIP WHERE TenGoi='Dùng thử VIP 1 ngày' AND ThoiHan=1 AND Gia=0
);

-- Quy ước:
-- NguoiDung.TrangThai = 1: tài khoản hoạt động; 0: tài khoản bị khóa.
-- LyDoKhoa chỉ có giá trị khi Admin khóa tài khoản.
-- Tài khoản đăng ký mới sẽ được hệ thống tự tạo DangKyVIP dùng thử 1 ngày.
