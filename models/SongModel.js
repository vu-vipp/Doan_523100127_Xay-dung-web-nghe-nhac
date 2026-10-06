const db = require('../config/db');
const SELECT = `SELECT b.*, c.TenCaSi, t.TenTheLoai, a.TenAlbum
 FROM BaiHat b JOIN CaSi c ON c.MaCaSi = b.MaCaSi
 JOIN TheLoai t ON t.MaTheLoai = b.MaTheLoai
 LEFT JOIN Album a ON a.MaAlbum = b.MaAlbum`;
module.exports = {
  async list({ search = '', genre = '', type = 'ALL', limit = 60, offset = 0, includeInactive = false } = {}) {
    let sql = SELECT + ' WHERE 1=1';
    const args = [];
    if (!includeInactive) sql += ' AND b.TrangThai = 1';
    if (search) { sql += ' AND (b.TenBaiHat LIKE ? OR c.TenCaSi LIKE ?)'; args.push(`%${search}%`, `%${search}%`); }
    if (genre && Number.isSafeInteger(Number(genre)) && Number(genre) > 0) { sql += ' AND b.MaTheLoai = ?'; args.push(Number(genre)); }
    if (type === 'FREE') sql += ' AND b.IsVIP = 0';
    if (type === 'VIP') sql += ' AND b.IsVIP = 1';
    sql += ' ORDER BY b.MaBaiHat DESC LIMIT ? OFFSET ?';
    args.push(Math.min(Math.max(Number(limit) || 60, 1), 200), Math.max(Number(offset) || 0, 0));
    const [rows] = await db.query(sql, args);
    return rows;
  },
  async count(type = 'ALL', includeInactive = false) {
    let sql='SELECT COUNT(*) AS total FROM BaiHat WHERE 1=1';
    if (!includeInactive) sql += ' AND TrangThai=1';
    if (type === 'FREE') sql += ' AND IsVIP=0';
    if (type === 'VIP') sql += ' AND IsVIP=1';
    const [rows]=await db.execute(sql);
    return Number(rows[0].total);
  },
  async latest(limit = 6) {
    const [rows] = await db.query(SELECT + ' WHERE b.TrangThai=1 ORDER BY b.MaBaiHat DESC LIMIT ?', [limit]);
    return rows;
  },
  async popular(limit = 5) {
    const [rows] = await db.query(SELECT + ' WHERE b.TrangThai=1 ORDER BY b.LuotNghe DESC, b.MaBaiHat DESC LIMIT ?', [limit]);
    return rows;
  },
  async find(id) {
    const [rows] = await db.execute(SELECT + ' WHERE b.MaBaiHat = ? AND b.TrangThai=1 LIMIT 1', [id]);
    return rows[0] || null;
  },
  async findAdmin(id) {
    const [rows] = await db.execute(SELECT + ' WHERE b.MaBaiHat = ? LIMIT 1', [id]);
    return rows[0] || null;
  },
  async genres() {
    const [rows] = await db.execute('SELECT * FROM TheLoai ORDER BY TenTheLoai');
    return rows;
  },
  async artists() {
    const [rows] = await db.execute('SELECT * FROM CaSi ORDER BY TenCaSi');
    return rows;
  },
  async albums() {
    const [rows] = await db.execute('SELECT a.*, c.TenCaSi FROM Album a JOIN CaSi c ON c.MaCaSi=a.MaCaSi ORDER BY a.TenAlbum');
    return rows;
  },
  async albumMatchesArtist(albumId, artistId) {
    const [rows] = await db.execute('SELECT MaAlbum FROM Album WHERE MaAlbum=? AND MaCaSi=? LIMIT 1', [albumId, artistId]);
    return rows.length > 0;
  },
  async increasePlays(id) {
    await db.execute('UPDATE BaiHat SET LuotNghe=LuotNghe+1 WHERE MaBaiHat=? AND TrangThai=1', [id]);
  },
  async insert(s) {
    const [result] = await db.execute(`INSERT INTO BaiHat
      (TenBaiHat, MaCaSi, MaTheLoai, MaAlbum, AnhBia, DuongDanAudio, ThoiLuong, IsVIP)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [s.name,s.artistId,s.genreId,s.albumId,s.cover,s.audio,s.duration,s.isVIP?1:0]);
    return result.insertId;
  },
  async update(id, s) {
    const [result] = await db.execute(`UPDATE BaiHat SET
      TenBaiHat=?, MaCaSi=?, MaTheLoai=?, MaAlbum=?, AnhBia=?, DuongDanAudio=?, ThoiLuong=?, IsVIP=?
      WHERE MaBaiHat=?`, [s.name,s.artistId,s.genreId,s.albumId,s.cover,s.audio,s.duration,s.isVIP?1:0,id]);
    return result.affectedRows;
  },
  async remove(id) {
    const [result] = await db.execute('UPDATE BaiHat SET TrangThai=0 WHERE MaBaiHat=? AND TrangThai=1', [id]);
    return result.affectedRows;
  },
  async restore(id) {
    const [result] = await db.execute('UPDATE BaiHat SET TrangThai=1 WHERE MaBaiHat=? AND TrangThai=0', [id]);
    return result.affectedRows;
  }
};
