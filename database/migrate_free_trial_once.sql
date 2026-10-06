-- Chạy MỘT LẦN trên database hiện tại để thay gói VIP 7 ngày bằng trải nghiệm FREE 1 ngày.
-- Script giữ lại gói 7 ngày cũ nếu nó đã được tham chiếu trong lịch sử DangKyVIP;
-- giao diện mới sẽ ẩn gói cũ đó để không làm sai dữ liệu lịch sử.
USE wave_music_mvc;

SET @trial_id := (
  SELECT MaGoi FROM GoiVIP
  WHERE Gia=0 AND ThoiHan=1
  ORDER BY MaGoi
  LIMIT 1
);

SET @seven_id := (
  SELECT MaGoi FROM GoiVIP
  WHERE TenGoi='VIP 7 ngày' AND ThoiHan=7
  ORDER BY MaGoi
  LIMIT 1
);

-- Nếu chưa có gói FREE thì tái sử dụng bản ghi VIP 7 ngày.
UPDATE GoiVIP
SET TenGoi='Trải nghiệm FREE 1 ngày',
    ThoiHan=1,
    Gia=0,
    MoTa='Gói trải nghiệm VIP miễn phí 1 ngày, chỉ dành cho tài khoản chưa từng đăng ký VIP.'
WHERE MaGoi=@seven_id AND @trial_id IS NULL;

-- Nếu không có cả VIP 7 ngày lẫn FREE thì tạo mới.
INSERT INTO GoiVIP (TenGoi,ThoiHan,Gia,MoTa)
SELECT 'Trải nghiệm FREE 1 ngày',1,0,
       'Gói trải nghiệm VIP miễn phí 1 ngày, chỉ dành cho tài khoản chưa từng đăng ký VIP.'
WHERE NOT EXISTS (
  SELECT 1 FROM GoiVIP WHERE Gia=0 AND ThoiHan=1
);

-- Chuẩn hóa tên gói FREE đang dùng.
UPDATE GoiVIP
SET TenGoi='Trải nghiệm FREE 1 ngày',
    MoTa='Gói trải nghiệm VIP miễn phí 1 ngày, chỉ dành cho tài khoản chưa từng đăng ký VIP.'
WHERE Gia=0 AND ThoiHan=1;
