const db = require('../config/db');

module.exports = {
  async findByEmail(email) {
    const [rows] = await db.execute('SELECT * FROM NguoiDung WHERE Email = ? LIMIT 1', [email]);
    return rows[0] || null;
  },
  async findById(id) {
    const [rows] = await db.execute(`SELECT MaNguoiDung, HoTen, Email, AnhDaiDien, VaiTro,
      TrangThaiVIP, TrangThai, LyDoKhoa, NgayDangKy
      FROM NguoiDung WHERE MaNguoiDung = ?`, [id]);
    return rows[0] || null;
  },
  async create({ name, email, hash }) {
    const [result] = await db.execute(
      'INSERT INTO NguoiDung (HoTen, Email, MatKhau, VaiTro, TrangThaiVIP, TrangThai) VALUES (?, ?, ?, ?, 0, 1)',
      [name, email, hash, 'USER']
    );
    return result.insertId;
  },
  async syncVIP(id, active) {
    await db.execute('UPDATE NguoiDung SET TrangThaiVIP = ? WHERE MaNguoiDung = ?', [active ? 1 : 0, id]);
  },
  async listAdmin({ search = '', status = 'ALL', limit = 10, offset = 0 } = {}) {
    const where = ["u.VaiTro='USER'"];
    const args = [];
    if (search) {
      where.push('(u.HoTen LIKE ? OR u.Email LIKE ?)');
      args.push(`%${search}%`, `%${search}%`);
    }
    if (status === 'ACTIVE') where.push('u.TrangThai=1');
    if (status === 'LOCKED') where.push('u.TrangThai=0');
    const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 100);
    const safeOffset = Math.max(Number(offset) || 0, 0);
    args.push(safeLimit, safeOffset);
    const [rows] = await db.query(`SELECT u.MaNguoiDung,u.HoTen,u.Email,u.VaiTro,u.TrangThaiVIP,u.TrangThai,u.LyDoKhoa,u.NgayDangKy,
      EXISTS(SELECT 1 FROM DangKyVIP dv WHERE dv.MaNguoiDung=u.MaNguoiDung AND dv.TrangThai='DA_XAC_NHAN'
        AND dv.NgayBatDau<=NOW() AND dv.NgayKetThuc>NOW()) AS VIPHienTai
      FROM NguoiDung u WHERE ${where.join(' AND ')} ORDER BY u.MaNguoiDung DESC LIMIT ? OFFSET ?`, args);
    return rows;
  },
  async countAdmin({ search = '', status = 'ALL' } = {}) {
    const where = ["VaiTro='USER'"];
    const args = [];
    if (search) {
      where.push('(HoTen LIKE ? OR Email LIKE ?)');
      args.push(`%${search}%`, `%${search}%`);
    }
    if (status === 'ACTIVE') where.push('TrangThai=1');
    if (status === 'LOCKED') where.push('TrangThai=0');
    const [rows] = await db.execute(`SELECT COUNT(*) AS total FROM NguoiDung WHERE ${where.join(' AND ')}`, args);
    return Number(rows[0]?.total || 0);
  },
  async lock(id, reason) {
    const [result] = await db.execute(`UPDATE NguoiDung SET TrangThai=0,LyDoKhoa=?
      WHERE MaNguoiDung=? AND VaiTro='USER' AND TrangThai=1`, [reason, id]);
    return result.affectedRows;
  },
  async unlock(id) {
    const [result] = await db.execute(`UPDATE NguoiDung SET TrangThai=1,LyDoKhoa=NULL
      WHERE MaNguoiDung=? AND VaiTro='USER' AND TrangThai=0`, [id]);
    return result.affectedRows;
  }
};
