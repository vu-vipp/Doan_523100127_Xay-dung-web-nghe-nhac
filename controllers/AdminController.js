const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Song = require('../models/SongModel');
const VIP = require('../models/VIPModel');
const User = require('../models/UserModel');
const { flash } = require('../middleware/auth');
const { inspectAudio } = require('../utils/audioMetadata');

const AUDIO_DIR = path.resolve(__dirname,'..','storage','audio');
const COVER_DIR = path.resolve(__dirname,'..','public','uploads','covers');
const COVER_MIMES = {
  '.jpg': new Set(['image/jpeg','application/octet-stream']),
  '.png': new Set(['image/png','application/octet-stream'])
};
const id = value => { const n=Number(value); return Number.isSafeInteger(n) && n>0 ? n : null; };
const ADMIN_PAGE_SIZE = 10;
const pageNo = value => { const n=Number(value); return Number.isSafeInteger(n) && n>0 ? n : 1; };

function parseSong(body, existing) {
  const name=String(body.name||'').trim();
  const artistId=id(body.artistId), genreId=id(body.genreId), albumId=body.albumId?id(body.albumId):null;
  const isVIP = String(body.isVIP||'0') === '1';
  if(!name || name.length>200 || !artistId || !genreId || (body.albumId&&!albumId) || !['0','1'].includes(String(body.isVIP||'0'))) {
    throw new Error('Tên bài hát, ca sĩ, thể loại hoặc quyền FREE/VIP không hợp lệ.');
  }
  return {
    name, artistId, genreId, albumId, isVIP,
    cover: existing?.AnhBia || null,
    audio: existing?.DuongDanAudio || '',
    duration: existing?.ThoiLuong || 0
  };
}

function inspectCover(file) {
  if(!file) return null;
  const ext=path.extname(file.originalname||'').toLowerCase();
  if(!COVER_MIMES[ext] || !COVER_MIMES[ext].has(file.mimetype)) throw new Error('Ảnh cover chỉ nhận file .jpg hoặc .png hợp lệ.');
  if(file.buffer.length > 5*1024*1024) throw new Error('Ảnh cover không được vượt quá 5 MB.');
  const b=file.buffer;
  const jpg=ext==='.jpg' && b.length>=3 && b[0]===0xff && b[1]===0xd8 && b[2]===0xff;
  const png=ext==='.png' && b.length>=8 && b.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  if(!jpg && !png) throw new Error('Ảnh cover không đúng định dạng .jpg/.png.');
  return ext;
}

function localCoverPath(url) {
  const match=/^\/static\/uploads\/covers\/([a-zA-Z0-9._-]+)$/.exec(String(url||''));
  return match ? path.join(COVER_DIR,match[1]) : null;
}
function localAudioPath(filename) {
  return /^upload-[a-zA-Z0-9-]+\.(mp3|aac)$/i.test(String(filename||'')) ? path.join(AUDIO_DIR,filename) : null;
}
async function songFormData() { return Promise.all([Song.artists(), Song.genres(), Song.albums()]); }

exports.dashboard = async (req,res,next) => {
  try {
    const filter=['VIP','FREE'].includes(req.query.type)?req.query.type:'ALL';
    const requestedPage=pageNo(req.query.page);
    const [pending,totalSongs,filteredCount] = await Promise.all([
      VIP.pending(), Song.count('ALL',true), Song.count(filter,true)
    ]);
    const totalPages=Math.max(1,Math.ceil(filteredCount/ADMIN_PAGE_SIZE));
    const page=Math.min(requestedPage,totalPages);
    const songs=await Song.list({
      type:filter,
      limit:ADMIN_PAGE_SIZE,
      offset:(page-1)*ADMIN_PAGE_SIZE,
      includeInactive:true
    });
    res.render('admin/index',{
      title:'Quản trị hệ thống',songs,pending,totalSongs,filteredCount,filter,
      page,totalPages,pageSize:ADMIN_PAGE_SIZE
    });
  } catch(err){next(err);}
};

exports.users=async(req,res,next)=>{
  try {
    const status=['ACTIVE','LOCKED'].includes(req.query.status)?req.query.status:'ALL';
    const search=String(req.query.q||'').trim().slice(0,100);
    const requestedPage=pageNo(req.query.page);
    const [totalUsers,filteredUsers]=await Promise.all([
      User.countAdmin(),
      User.countAdmin({search,status})
    ]);
    const totalPages=Math.max(1,Math.ceil(filteredUsers/ADMIN_PAGE_SIZE));
    const page=Math.min(requestedPage,totalPages);
    const users=await User.listAdmin({
      search,status,limit:ADMIN_PAGE_SIZE,offset:(page-1)*ADMIN_PAGE_SIZE
    });
    res.render('admin/users',{
      title:'Quản lý người dùng',users,totalUsers,filteredUsers,search,status,
      page,totalPages,pageSize:ADMIN_PAGE_SIZE
    });
  } catch(err){next(err);}
};

exports.musicLibrary = async (req,res,next) => {
  try {
    const search=String(req.query.q||'').trim().slice(0,100);
    const genre=String(req.query.genre||'').slice(0,12);
    const filter=['VIP','FREE'].includes(req.query.type)?req.query.type:'ALL';
    const [songs,genres]=await Promise.all([Song.list({search,genre,type:filter,limit:200}),Song.genres()]);
    res.render('songs/index',{title:'Bài hát – Nghe thử',songs,genres,search,genre,filter,adminLibrary:true});
  } catch(err){next(err);}
};
exports.musicPreview = async (req,res,next) => {
  try {
    const song=await Song.find(id(req.params.id));
    if(!song) return res.status(404).render('errors/error',{title:'Không tìm thấy',message:'Bài hát không tồn tại hoặc đã bị khóa/ẩn.'});
    res.render('songs/detail',{title:`Nghe thử – ${song.TenBaiHat}`,song,playlists:[],adminPreview:true});
  } catch(err){next(err);}
};
exports.newForm = async (req,res,next) => {
  try { const [artists,genres,albums]=await songFormData();
    res.render('admin/song-form',{title:'Thêm bài hát',song:null,artists,genres,albums});
  } catch(err){next(err);}
};
exports.editForm = async (req,res,next) => {
  try {const song=await Song.findAdmin(id(req.params.id));
    if(!song) return res.status(404).render('errors/error',{title:'Không tìm thấy',message:'Bài hát không tồn tại.'});
    const [artists,genres,albums]=await songFormData();
    res.render('admin/song-form',{title:'Sửa bài hát',song,artists,genres,albums});
  } catch(err){next(err);}
};

async function save(req,res,next,editing) {
  let newAudioPath=null, newCoverPath=null;
  try {
    const old=editing?await Song.findAdmin(id(req.params.id)):null;
    if(editing&&!old) return res.sendStatus(404);
    const song=parseSong(req.body,old);
    if(song.albumId && !(await Song.albumMatchesArtist(song.albumId,song.artistId))) {
      throw new Error('Album đã chọn không thuộc ca sĩ của bài hát.');
    }

    const audioFile=req.files?.audioFile?.[0] || null;
    if(audioFile) {
      const meta=inspectAudio(audioFile);
      const filename=`upload-${crypto.randomUUID()}${meta.ext}`;
      await fs.promises.mkdir(AUDIO_DIR,{recursive:true});
      newAudioPath=path.join(AUDIO_DIR,filename);
      await fs.promises.writeFile(newAudioPath,audioFile.buffer,{flag:'wx'});
      song.audio=filename;
      song.duration=meta.duration;
    }
    if(!song.audio) throw new Error('Bạn cần chọn tệp âm thanh .mp3 hoặc .aac khi thêm bài hát.');
    if(!song.duration || song.duration<=0) throw new Error('Không xác định được thời lượng bài hát.');

    const coverFile=req.files?.coverFile?.[0] || null;
    if(coverFile) {
      const ext=inspectCover(coverFile);
      const filename=`cover-${crypto.randomUUID()}${ext}`;
      await fs.promises.mkdir(COVER_DIR,{recursive:true});
      newCoverPath=path.join(COVER_DIR,filename);
      await fs.promises.writeFile(newCoverPath,coverFile.buffer,{flag:'wx'});
      song.cover=`/static/uploads/covers/${filename}`;
    }

    if(editing) await Song.update(old.MaBaiHat,song); else await Song.insert(song);

    if(editing && audioFile) {
      const oldPath=localAudioPath(old.DuongDanAudio);
      if(oldPath) await fs.promises.unlink(oldPath).catch(()=>{});
    }
    if(editing && coverFile) {
      const oldPath=localCoverPath(old.AnhBia);
      if(oldPath) await fs.promises.unlink(oldPath).catch(()=>{});
    }

    flash(req,editing?'Đã cập nhật bài hát.':'Đã thêm bài hát mới.','success');
    res.redirect('/admin');
  } catch(err) {
    if(newAudioPath) await fs.promises.unlink(newAudioPath).catch(()=>{});
    if(newCoverPath) await fs.promises.unlink(newCoverPath).catch(()=>{});
    if (err.message && (err.message.includes('không hợp lệ') || err.message.includes('cần') || err.message.includes('Chỉ nhận') || err.message.includes('không thuộc') || err.message.includes('không đúng') || err.message.includes('không được') || err.message.includes('Không đọc') || err.message.includes('Không xác định') || err.code==='ER_NO_REFERENCED_ROW_2')) {
      flash(req,err.code==='ER_NO_REFERENCED_ROW_2'?'Ca sĩ, album hoặc thể loại không tồn tại.':err.message,'warning');
      return res.redirect(editing?`/admin/songs/${req.params.id}/edit`:'/admin/songs/new');
    }
    next(err);
  }
}
exports.create=(req,res,next)=>save(req,res,next,false);
exports.update=(req,res,next)=>save(req,res,next,true);
exports.remove=async(req,res,next)=>{
  try {const changed=await Song.remove(id(req.params.id));
    flash(req,changed?'Đã khóa/ẩn bài hát (Soft Delete). Dữ liệu vẫn được giữ trong CSDL.':'Bài hát không tồn tại hoặc đã bị ẩn.',changed?'success':'warning');
    res.redirect('/admin');
  } catch(err){next(err);}
};
exports.restore=async(req,res,next)=>{
  try {
    const changed=await Song.restore(id(req.params.id));
    flash(req,changed?'Đã mở khóa và khôi phục bài hát.':'Bài hát không tồn tại hoặc đang hoạt động.',changed?'success':'warning');
    res.redirect('/admin#songs');
  } catch(err){next(err);}
};
exports.decideVIP=async(req,res,next)=>{
  try { const registrationId=id(req.params.id);
    const action=req.params.action;
    if(!registrationId || !['approve','reject'].includes(action)) return res.sendStatus(400);
    const ok=await VIP.decide(registrationId,action);
    flash(req,ok?(action==='approve'?'Đã xác nhận và kích hoạt VIP.':'Đã từ chối yêu cầu VIP.'):'Không thể xử lý yêu cầu này.',ok?'success':'warning');
    res.redirect('/admin#vip');
  } catch(err){next(err);}
};

exports.lockUser=async(req,res,next)=>{
  try {
    const userId=id(req.params.id);
    const reason=String(req.body.reason||'').trim().replace(/\s+/g,' ');
    if(!userId) return res.sendStatus(400);
    if(reason.length<3 || reason.length>255) {
      flash(req,'Lý do khóa phải từ 3 đến 255 ký tự.','warning');
      return res.redirect('/admin/users');
    }
    const changed=await User.lock(userId,reason);
    flash(req,changed?'Đã khóa tài khoản người dùng và lưu lý do.':'Không thể khóa tài khoản này.',changed?'success':'warning');
    res.redirect('/admin/users');
  } catch(err){next(err);}
};
exports.unlockUser=async(req,res,next)=>{
  try {
    const userId=id(req.params.id);
    if(!userId) return res.sendStatus(400);
    const changed=await User.unlock(userId);
    flash(req,changed?'Đã mở khóa tài khoản người dùng.':'Không thể mở khóa tài khoản này.',changed?'success':'warning');
    res.redirect('/admin/users');
  } catch(err){next(err);}
};
