-- Chạy MỘT LẦN nếu database hiện tại vẫn còn cột LoaiBaiHat.
-- Dùng cho MySQL 8.0.16+; giữ nguyên dữ liệu bài hát hiện có.
USE wave_music_mvc;

ALTER TABLE BaiHat
  ADD COLUMN IsVIP BOOLEAN NULL AFTER ThoiLuong;

UPDATE BaiHat
SET IsVIP = CASE WHEN LoaiBaiHat = 'VIP' THEN TRUE ELSE FALSE END;

ALTER TABLE BaiHat
  MODIFY COLUMN IsVIP BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN TrangThai BOOLEAN NOT NULL DEFAULT TRUE AFTER IsVIP;

ALTER TABLE BaiHat DROP CHECK chk_loaibaihat;
ALTER TABLE BaiHat DROP COLUMN LoaiBaiHat;

-- Quy ước:
-- IsVIP = 0: FREE; IsVIP = 1: VIP
-- TrangThai = 1: đang hoạt động; TrangThai = 0: khóa/ẩn (Soft Delete)
