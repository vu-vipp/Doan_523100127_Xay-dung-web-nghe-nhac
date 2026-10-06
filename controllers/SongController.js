const fs = require('fs');
const path = require('path');
const Song = require('../models/SongModel');
const Playlist = require('../models/PlaylistModel');
const { flash } = require('../middleware/auth');
const AUDIO_DIR = path.resolve(__dirname,'..','storage','audio');
const TYPES = {'.mp3':'audio/mpeg','.aac':'audio/aac','.wav':'audio/wav','.ogg':'audio/ogg','.m4a':'audio/mp4'};
exports.home = async (req,res,next) => {
  try { const [latest,popular,genres] = await Promise.all([Song.latest(8),Song.popular(5),Song.genres()]);
    res.render('home',{title:'Khám phá âm nhạc',latest,popular,genres});
  } catch(err) { next(err); }
};
exports.list = async (req,res,next) => {
  try {
    const search = String(req.query.q || '').trim().slice(0,100);
    const genre = String(req.query.genre || '').slice(0,12);
    const [songs,genres] = await Promise.all([Song.list({search,genre}),Song.genres()]);
    res.render('songs/index',{title:'Thư viện bài hát',songs,genres,search,genre,filter:'ALL',adminLibrary:false});
  } catch(err) { next(err); }
};
exports.detail = async (req,res,next) => {
  try {
    const song = await Song.find(req.params.id);
    if(!song) return res.status(404).render('errors/error',{title:'Không tìm thấy',message:'Bài hát không tồn tại.'});
    const playlists=req.user && req.user.VaiTro!=='ADMIN' ? await Playlist.mine(req.user.MaNguoiDung) : [];
    res.render('songs/detail',{title:song.TenBaiHat,song,playlists,adminPreview:false});
  } catch(err) { next(err); }
};
exports.stream = async (req,res,next) => {
  try {
    const song = await Song.find(req.params.id);
    if (!song) return res.sendStatus(404);
    // Admin may inspect VIP audio without buying a subscription; normal users still
    // require an approved and unexpired DangKyVIP (req.activeVIP is checked server-side).
    if (Boolean(song.IsVIP) && req.user?.VaiTro !== 'ADMIN' && (!req.user || !req.activeVIP)) return res.status(403).json({error:'Bạn cần đăng ký hoặc gia hạn VIP để phát bài hát này.'});
    // Database stores only a basename, never a web URL or a path supplied by the browser.
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,250}\.(mp3|aac|wav|ogg|m4a)$/i.test(song.DuongDanAudio)) return res.sendStatus(404);
    const filename = path.join(AUDIO_DIR,song.DuongDanAudio);
    const stat = await fs.promises.stat(filename).catch(() => null);
    if (!stat || !stat.isFile()) return res.status(404).json({error:'Tệp âm thanh chưa có trên máy chủ.'});
    const total = stat.size;
    if (!total) return res.sendStatus(404);
    const contentType = TYPES[path.extname(filename).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.range;
    let start=0,end=total-1,status=200;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!m || (!m[1] && !m[2])) { res.set('Content-Range',`bytes */${total}`); return res.sendStatus(416); }
      if (!m[1]) { const suffix=Number(m[2]); if(!Number.isSafeInteger(suffix)||suffix<=0) { res.set('Content-Range',`bytes */${total}`); return res.sendStatus(416); } start=Math.max(0,total-suffix); }
      else { start=Number(m[1]); end=m[2] ? Number(m[2]) : total-1; }
      if (!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=total||end<start) {
        res.set('Content-Range',`bytes */${total}`); return res.sendStatus(416);
      }
      end=Math.min(end,total-1); status=206;
      res.set('Content-Range',`bytes ${start}-${end}/${total}`);
    }
    res.status(status);
    res.set({'Content-Type':contentType,'Accept-Ranges':'bytes','Content-Length':String(end-start+1),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
    if (!range || start===0) Song.increasePlays(song.MaBaiHat).catch(console.error);
    const stream = fs.createReadStream(filename,{start,end});
    stream.on('error',err=>{ console.error(err); if(!res.headersSent) res.sendStatus(500); else res.destroy(err); });
    stream.pipe(res);
  } catch(err) { next(err); }
};
