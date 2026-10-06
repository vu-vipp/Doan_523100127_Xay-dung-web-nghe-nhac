const bcrypt = require('bcryptjs');
const User = require('../models/UserModel');
const { flash } = require('../middleware/auth');
const emailValid = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
exports.loginForm = (req,res) => res.render('auth/login',{title:'Đăng nhập'});
exports.registerForm = (req,res) => res.render('auth/register',{title:'Đăng ký'});
exports.register = async (req,res,next) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (name.length < 2 || name.length > 100 || !emailValid(email) || email.length > 150 || password.length < 8 || password.length > 128) {
      flash(req,'Họ tên từ 2–100 ký tự, email hợp lệ và mật khẩu từ 8–128 ký tự.','warning'); return res.redirect('/register');
    }
    if (await User.findByEmail(email)) { flash(req,'Email đã được đăng ký.','warning'); return res.redirect('/register'); }
    const hash = await bcrypt.hash(password, 12);
    try { await User.create({name,email,hash}); }
    catch(err) { if(err.code==='ER_DUP_ENTRY') { flash(req,'Email đã được đăng ký.','warning'); return res.redirect('/register'); } throw err; }
    flash(req,'Đăng ký thành công. Bạn được tặng VIP dùng thử 1 ngày. Hãy đăng nhập!','success'); res.redirect('/login');
  } catch (err) { next(err); }
};
exports.login = async (req,res,next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = email.length<=150 && password.length<=128 ? await User.findByEmail(email) : null;
    if (!user || !(await bcrypt.compare(password,user.MatKhau))) {
      flash(req,'Email hoặc mật khẩu không chính xác.','warning'); return res.redirect('/login');
    }
    if (Number(user.TrangThai) === 0) {
      const reason = String(user.LyDoKhoa || '').trim();
      flash(req,`Tài khoản đã bị khóa.${reason ? ' Lý do: ' + reason : ' Vui lòng liên hệ quản trị viên.'}`,'warning');
      return res.redirect('/login');
    }
    req.session.regenerate(err => {
      if(err) return next(err);
      req.session.userId = user.MaNguoiDung;
      flash(req,`Chào mừng ${user.HoTen}!`,'success');
      req.session.save(err2 => err2 ? next(err2) : res.redirect(user.VaiTro==='ADMIN' ? '/admin' : '/'));
    });
  } catch(err) { next(err); }
};
exports.logout = (req,res,next) => req.session.destroy(err => {
  if(err) return next(err);
  res.clearCookie('wave.sid'); res.redirect('/');
});
