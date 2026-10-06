const Playlist = require('../models/PlaylistModel');
const { flash } = require('../middleware/auth');
const id = value => { const n=Number(value); return Number.isSafeInteger(n) && n>0 ? n : 0; };
exports.list = async (req,res,next) => {
  try { const playlists=await Playlist.mine(req.user.MaNguoiDung);
    res.render('playlists/index',{title:'Playlist của tôi',playlists});
  } catch(err){next(err);}
};
exports.detail = async (req,res,next) => {
  try {
    const playlist=await Playlist.own(id(req.params.id),req.user.MaNguoiDung);
    if(!playlist) return res.status(404).render('errors/error',{title:'Không tìm thấy',message:'Playlist không tồn tại hoặc không thuộc tài khoản của bạn.'});
    const songs = await Playlist.songs(playlist.MaPlaylist);
    res.render('playlists/detail',{title:playlist.TenPlaylist,playlist,songs});
  } catch(err){next(err);}
};
exports.create = async (req,res,next) => {
  try { const name=String(req.body.name||'').trim();
    if(!name || name.length>150){flash(req,'Tên playlist phải có từ 1–150 ký tự.','warning');return res.redirect('/playlists');}
    await Playlist.create(req.user.MaNguoiDung,name); flash(req,'Đã tạo playlist.','success');res.redirect('/playlists');
  } catch(err){next(err);}
};
exports.rename = async (req,res,next) => {
  try { const playlistId=id(req.params.id), name=String(req.body.name||'').trim();
    if(!name||name.length>150){flash(req,'Tên playlist không hợp lệ.','warning');return res.redirect('/playlists/'+playlistId);}
    const changed=await Playlist.rename(playlistId,req.user.MaNguoiDung,name);
    flash(req,changed?'Đã đổi tên playlist.':'Không tìm thấy playlist của bạn.',changed?'success':'warning');res.redirect('/playlists/'+playlistId);
  } catch(err){next(err);}
};
exports.remove = async (req,res,next) => {
  try { const changed=await Playlist.remove(id(req.params.id),req.user.MaNguoiDung);
    flash(req,changed?'Đã xóa playlist.':'Không tìm thấy playlist của bạn.',changed?'success':'warning');res.redirect('/playlists');
  } catch(err){next(err);}
};
// Song page is the sole UI entry for adding to a playlist. Ownership is checked
// both here (for clear feedback) and atomically by Playlist.add() in SQL.
exports.addFromSong = async (req,res,next) => {
  try {
    const songId=id(req.params.id), playlistId=id(req.body.playlistId);
    if(!songId) return res.sendStatus(404);
    const playlist=playlistId?await Playlist.own(playlistId,req.user.MaNguoiDung):null;
    if(!playlist) {
      flash(req,'Playlist không tồn tại hoặc không thuộc tài khoản của bạn.','warning');
      return res.redirect('/songs/'+songId);
    }
    const changed=await Playlist.add(playlistId,req.user.MaNguoiDung,songId);
    flash(req,changed?'Đã thêm bài hát vào playlist '+playlist.TenPlaylist+'.':'Không thể thêm: bài hát đã có trong playlist hoặc không tồn tại.',changed?'success':'warning');
    return res.redirect('/songs/'+songId);
  } catch(err){next(err);}
};
exports.removeSong = async (req,res,next) => {
  try { const playlistId=id(req.params.id),songId=id(req.body.songId);
    const changed=await Playlist.removeSong(playlistId,req.user.MaNguoiDung,songId);
    flash(req,changed?'Đã xóa bài hát khỏi playlist.':'Không tìm thấy bài hát trong playlist của bạn.',changed?'success':'warning');
    res.redirect('/playlists/'+playlistId);
  } catch(err){next(err);}
};
