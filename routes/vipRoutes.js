const r=require('express').Router();
const c=require('../controllers/VIPController');
const {requireAuth,csrfGuard}=require('../middleware/auth');
r.get('/vip',c.page);
r.post('/vip/subscribe',requireAuth,csrfGuard,c.subscribe);
r.get('/vip/payment',requireAuth,c.paymentPage);
r.post('/vip/payment/confirm',requireAuth,csrfGuard,c.confirmPayment);
module.exports=r;
