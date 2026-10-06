require('dotenv').config();
const express=require('express');
const session=require('express-session');
const path=require('path');
const db=require('./config/db');
const {loadViewer}=require('./middleware/auth');
const songs=require('./controllers/SongController');

if(!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length<32) {
  console.error('Lỗi: SESSION_SECRET phải có ít nhất 32 ký tự trong .env. Chạy npm run setup hoặc tạo secret mới.');
  process.exit(1);
}
const app=express();
if(process.env.NODE_ENV==='production') app.set('trust proxy',1);
app.disable('x-powered-by');
app.set('view engine','ejs');
app.set('views',path.join(__dirname,'views'));
app.use(express.urlencoded({extended:false,limit:'32kb'}));
app.use(express.json({limit:'32kb'}));
app.use('/static',express.static(path.join(__dirname,'public'),{maxAge:'1h',index:false}));
// Demo-only MemoryStore. Replace with a persistent session store for production.
app.use(session({name:'wave.sid',secret:process.env.SESSION_SECRET,resave:false,saveUninitialized:false,
  cookie:{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:7*24*3600*1000}}));
app.use(loadViewer);
// Admin has a dedicated workspace, but may browse/preview all songs.
app.use((req,res,next)=>{
  if(req.user?.VaiTro==='ADMIN' && req.method==='GET') {
    if(req.path === '/songs') return res.redirect('/admin/music');
    // Do not redirect the audio endpoint: administrators can listen to VIP previews.
    const songDetail = /^\/songs\/(\d+)$/.exec(req.path);
    if(songDetail) return res.redirect(`/admin/music/${songDetail[1]}`);
    if(req.path==='/' || /^\/(?:playlists|vip)(?:\/|$)/.test(req.path) ||
       /^\/(?:login|register)$/.test(req.path)) return res.redirect('/admin');
  }
  next();
});
app.get('/',songs.home);
app.use(require('./routes/authRoutes'));
app.use(require('./routes/songRoutes'));
app.use(require('./routes/playlistRoutes'));
app.use(require('./routes/vipRoutes'));
app.use(require('./routes/adminRoutes'));
app.use((req,res)=>res.status(404).render('errors/error',{title:'404 – Không tìm thấy',message:'Trang bạn yêu cầu không tồn tại.'}));
app.use((err,req,res,next)=>{
  console.error(err);
  if(res.headersSent) return next(err);
  const message=err.code==='LIMIT_FILE_SIZE'?'Tệp âm thanh vượt quá 25 MB.':
    err.code==='ER_ACCESS_DENIED_ERROR'?'Không thể đăng nhập MySQL. Hãy kiểm tra DB_USER / DB_PASSWORD trong .env.':
    'Đã xảy ra lỗi. Hãy kiểm tra terminal để xem chi tiết.';
  res.status(err.code==='LIMIT_FILE_SIZE'?413:500).render('errors/error',{title:'Có lỗi xảy ra',message});
});
const port=Number(process.env.PORT||3000);
if(require.main===module){
  db.query('SELECT 1').then(()=>app.listen(port,()=>console.log(`WAVE Music chạy tại http://localhost:${port}`)))
    .catch(err=>{console.error('Không kết nối được MySQL:',err.message);process.exitCode=1; db.end().catch(()=>{});});
}
module.exports=app;
