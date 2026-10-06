const r=require('express').Router();
const c=require('../controllers/AuthController');
const {csrfGuard,requireAuth}=require('../middleware/auth');
r.get('/login',(req,res,next)=>req.user?res.redirect('/'):c.loginForm(req,res,next));
r.post('/login',csrfGuard,c.login);
r.get('/register',(req,res,next)=>req.user?res.redirect('/'):c.registerForm(req,res,next));
r.post('/register',csrfGuard,c.register);
r.post('/logout',requireAuth,csrfGuard,c.logout);
module.exports=r;
