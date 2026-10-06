const User = require('../models/UserModel');
const VIP = require('../models/VIPModel');
const crypto = require('crypto');

const flash = (req, message, type = 'info') => { req.session.flash = { message, type }; };

async function loadViewer(req, res, next) {
  try {
    req.user = null;
    req.activeVIP = null;
    if (req.session.userId) {
      const user = await User.findById(req.session.userId);
      if (!user) { delete req.session.userId; }
      else {
        req.user = user;
        req.activeVIP = await VIP.active(user.MaNguoiDung);
        const active = Boolean(req.activeVIP);
        if (Boolean(user.TrangThaiVIP) !== active) await User.syncVIP(user.MaNguoiDung, active);
      }
    }
    if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    res.locals.viewer = req.user;
    res.locals.activeVIP = req.activeVIP;
    res.locals.csrfToken = req.session.csrfToken;
    res.locals.flash = req.session.flash || null;
    delete req.session.flash;
    res.locals.formatPrice = value => new Intl.NumberFormat('vi-VN').format(Number(value || 0)) + ' ₫';
    res.locals.formatDuration = secs => `${Math.floor(Number(secs || 0)/60)}:${String(Number(secs || 0)%60).padStart(2,'0')}`;
    next();
  } catch (err) { next(err); }
}
function csrfGuard(req, res, next) {
  const sent = req.body?._csrf || req.get('x-csrf-token');
  const expected = req.session.csrfToken;
  if (typeof sent !== 'string' || typeof expected !== 'string' || sent.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected))) {
    return res.status(403).render('errors/error', { title:'Yêu cầu không hợp lệ', message:'Mã bảo vệ biểu mẫu không hợp lệ. Hãy tải lại trang và thử lại.' });
  }
  next();
}
function requireAuth(req,res,next) {
  if (!req.user) { flash(req, 'Hãy đăng nhập để sử dụng chức năng này.', 'warning'); return res.redirect('/login'); }
  next();
}
function requireAdmin(req,res,next) {
  if (!req.user) { flash(req,'Hãy đăng nhập tài khoản quản trị.', 'warning'); return res.redirect('/login'); }
  if (req.user.VaiTro !== 'ADMIN') return res.status(403).render('errors/error',{title:'Không có quyền',message:'Chỉ tài khoản Admin được truy cập trang này.'});
  next();
}
module.exports = { loadViewer, csrfGuard, requireAuth, requireAdmin, flash };
