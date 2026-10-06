require('dotenv').config();
const bcrypt=require('bcryptjs');
const db=require('../config/db');
(async()=>{
  const email=String(process.env.ADMIN_EMAIL||'').trim().toLowerCase();
  const password=String(process.env.ADMIN_PASSWORD||'');
  if(!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length<12) {
    throw new Error('Đặt ADMIN_EMAIL hợp lệ và ADMIN_PASSWORD ít nhất 12 ký tự trong .env trước khi chạy create-admin.');
  }
  const [existing]=await db.execute('SELECT MaNguoiDung FROM NguoiDung WHERE Email=?',[email]);
  if(existing.length){console.log('Email đã tồn tại. Không tự động nâng quyền hoặc đổi mật khẩu. Hãy chọn ADMIN_EMAIL khác.');return;}
  const hash=await bcrypt.hash(password,12);
  await db.execute('INSERT INTO NguoiDung(HoTen,Email,MatKhau,VaiTro) VALUES (?,?,?,?)',['Quản trị WAVE',email,hash,'ADMIN']);
  console.log(`Đã tạo tài khoản Admin: ${email}. Đăng nhập bằng mật khẩu ADMIN_PASSWORD trong .env.`);
})().catch(err=>{console.error('Tạo admin lỗi:',err.message);process.exitCode=1;}).finally(()=>db.end());
