const VIP = require('../models/VIPModel');
const { flash } = require('../middleware/auth');

const CHECKOUT_TTL_MS = 30 * 60 * 1000;
const PAYMENT_METHODS = new Set(['BANK_TRANSFER', 'BANK_CARD']);

function checkoutValid(checkout) {
  return checkout && Number.isSafeInteger(checkout.planId) && checkout.planId > 0 &&
    Number.isFinite(checkout.createdAt) && Date.now() - checkout.createdAt <= CHECKOUT_TTL_MS;
}

function paymentReference(userId, planId) {
  return `WAVE VIP U${userId} G${planId}`;
}

exports.page = async (req,res,next) => {
  try {
    const [plans,history] = await Promise.all([
      VIP.plans(req.user ? req.user.MaNguoiDung : null),
      req.user ? VIP.history(req.user.MaNguoiDung) : Promise.resolve([])
    ]);
    res.render('vip/index',{title:'Đặc quyền VIP',plans,history});
  } catch(err){next(err);}
};

// Bước 1: người dùng chọn gói. Chưa tạo đăng ký ngay, chỉ mở phiên thanh toán mô phỏng.
exports.subscribe = async (req,res,next) => {
  try {
    const planId = Number(req.body.planId);
    if(!Number.isSafeInteger(planId) || planId <= 0) {
      flash(req,'Gói VIP không hợp lệ.','warning');
      return res.redirect('/vip');
    }
    const plan = await VIP.plan(planId);
    if (!plan) {
      flash(req,'Gói VIP không tồn tại.','warning');
      return res.redirect('/vip');
    }

    // Gói trải nghiệm FREE 1 ngày được kích hoạt ngay, không qua thanh toán/Admin.
    if (Number(plan.Gia) === 0 && Number(plan.ThoiHan) === 1) {
      const result = await VIP.claimTrial(req.user.MaNguoiDung, planId);
      const msg = {
        activated:'Đã kích hoạt gói trải nghiệm FREE 1 ngày. Bạn có thể nghe nhạc VIP ngay.',
        ineligible:'Gói trải nghiệm chỉ dành cho tài khoản chưa từng đăng ký VIP.',
        missing_plan:'Gói trải nghiệm không hợp lệ.',
        missing_user:'Tài khoản không tồn tại hoặc đang bị khóa.'
      };
      flash(req,msg[result] || 'Không thể kích hoạt gói trải nghiệm.',result === 'activated' ? 'success' : 'warning');
      return res.redirect('/vip');
    }

    const prepared = await VIP.prepareCheckout(req.user.MaNguoiDung, planId);
    if (prepared.status !== 'ready') {
      const msg = {
        existing:'Bạn đã có VIP còn hạn hoặc đang có yêu cầu chờ xác nhận.',
        missing_plan:'Gói VIP không tồn tại.',
        missing_user:'Tài khoản không tồn tại.'
      };
      flash(req,msg[prepared.status] || 'Không thể bắt đầu thanh toán.','warning');
      return res.redirect('/vip');
    }
    req.session.vipCheckout = { planId, createdAt: Date.now() };
    res.redirect('/vip/payment');
  } catch(err){next(err);}
};

// Bước 2: hiển thị cổng thanh toán mô phỏng theo phong cách WAVE.
exports.paymentPage = async (req,res,next) => {
  try {
    const checkout = req.session.vipCheckout;
    if (!checkoutValid(checkout)) {
      delete req.session.vipCheckout;
      flash(req,'Phiên thanh toán đã hết hạn. Hãy chọn lại gói VIP.','warning');
      return res.redirect('/vip');
    }
    const plan = await VIP.plan(checkout.planId);
    if (!plan || Number(plan.Gia) <= 0) {
      delete req.session.vipCheckout;
      flash(req,'Gói thanh toán không hợp lệ.','warning');
      return res.redirect('/vip');
    }
    res.render('vip/payment',{
      title:'Thanh toán VIP',
      plan,
      paymentRef: paymentReference(req.user.MaNguoiDung, plan.MaGoi),
      demoBank: {
        name:'WAVE Demo Bank',
        account:'0000 1234 5678',
        holder:'WAVE MUSIC DEMO'
      }
    });
  } catch(err){next(err);}
};

// Bước 3: xác nhận thanh toán mô phỏng rồi mới tạo yêu cầu CHO_XAC_NHAN cho Admin.
exports.confirmPayment = async (req,res,next) => {
  try {
    const checkout = req.session.vipCheckout;
    if (!checkoutValid(checkout)) {
      delete req.session.vipCheckout;
      flash(req,'Phiên thanh toán đã hết hạn. Hãy chọn lại gói VIP.','warning');
      return res.redirect('/vip');
    }
    const method = String(req.body.paymentMethod || '');
    if (!PAYMENT_METHODS.has(method)) {
      flash(req,'Hãy chọn phương thức thanh toán mô phỏng.','warning');
      return res.redirect('/vip/payment');
    }
    const result = await VIP.request(req.user.MaNguoiDung, checkout.planId);
    if (result === 'created') delete req.session.vipCheckout;
    const msg = {
      created:'Đã ghi nhận xác nhận thanh toán mô phỏng. Yêu cầu VIP đang chờ Admin duyệt.',
      existing:'Bạn đã có VIP còn hạn hoặc đang có yêu cầu chờ xác nhận.',
      missing_plan:'Gói VIP không tồn tại.',
      missing_user:'Tài khoản không tồn tại.'
    };
    flash(req,msg[result] || 'Không thể tạo đăng ký VIP.',result === 'created' ? 'success' : 'warning');
    res.redirect('/vip');
  } catch(err){next(err);}
};
