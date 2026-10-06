const db = require('../config/db');
module.exports = {
  async mine(userId) {
    const [rows] = await db.execute(`SELECT p.*, COUNT(b.MaBaiHat) AS SoBaiHat
      FROM Playlist p LEFT JOIN ChiTietPlaylist ct ON ct.MaPlaylist=p.MaPlaylist
      LEFT JOIN BaiHat b ON b.MaBaiHat=ct.MaBaiHat AND b.TrangThai=1
      WHERE p.MaNguoiDung=? GROUP BY p.MaPlaylist ORDER BY p.NgayTao DESC`, [userId]);
    return rows;
  },
  async own(playlistId, userId) {
    const [rows] = await db.execute('SELECT * FROM Playlist WHERE MaPlaylist=? AND MaNguoiDung=?', [playlistId,userId]);
    return rows[0] || null;
  },
  async songs(playlistId) {
    const [rows] = await db.execute(`SELECT b.*, c.TenCaSi, t.TenTheLoai, ct.NgayThem
      FROM ChiTietPlaylist ct JOIN BaiHat b ON b.MaBaiHat=ct.MaBaiHat
      JOIN CaSi c ON c.MaCaSi=b.MaCaSi JOIN TheLoai t ON t.MaTheLoai=b.MaTheLoai
      WHERE ct.MaPlaylist=? AND b.TrangThai=1 ORDER BY ct.NgayThem DESC`, [playlistId]);
    return rows;
  },
  async create(userId, name) {
    await db.execute('INSERT INTO Playlist (TenPlaylist, MaNguoiDung) VALUES (?,?)', [name,userId]);
  },
  async rename(playlistId, userId, name) {
    const [r] = await db.execute('UPDATE Playlist SET TenPlaylist=? WHERE MaPlaylist=? AND MaNguoiDung=?', [name,playlistId,userId]);
    return r.affectedRows;
  },
  async remove(playlistId, userId) {
    const [r] = await db.execute('DELETE FROM Playlist WHERE MaPlaylist=? AND MaNguoiDung=?', [playlistId,userId]);
    return r.affectedRows;
  },
  async add(playlistId, userId, songId) {
    const [r] = await db.execute(`INSERT IGNORE INTO ChiTietPlaylist (MaPlaylist, MaBaiHat)
      SELECT p.MaPlaylist, b.MaBaiHat FROM Playlist p JOIN BaiHat b ON b.MaBaiHat=? AND b.TrangThai=1
      WHERE p.MaPlaylist=? AND p.MaNguoiDung=?`, [songId,playlistId,userId]);
    return r.affectedRows;
  },
  async removeSong(playlistId, userId, songId) {
    const [r] = await db.execute(`DELETE ct FROM ChiTietPlaylist ct
      JOIN Playlist p ON p.MaPlaylist=ct.MaPlaylist
      WHERE ct.MaPlaylist=? AND ct.MaBaiHat=? AND p.MaNguoiDung=?`, [playlistId,songId,userId]);
    return r.affectedRows;
  }
};
