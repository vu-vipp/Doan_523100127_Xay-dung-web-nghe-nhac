const db = require('../config/db');
module.exports = {
  async findByEmail(email) {
    const [rows] = await db.execute('SELECT * FROM NguoiDung WHERE Email = ? LIMIT 1', [email]);
    return rows[0] || null;
  },
  async findById(id) {
    const [rows] = await db.execute('SELECT MaNguoiDung, HoTen, Email, AnhDaiDien, VaiTro, TrangThaiVIP, NgayDangKy FROM NguoiDung WHERE MaNguoiDung = ?', [id]);
    return rows[0] || null;
  },
  async create({ name, email, hash }) {
    const [result] = await db.execute('INSERT INTO NguoiDung (HoTen, Email, MatKhau, VaiTro) VALUES (?, ?, ?, ?)', [name, email, hash, 'USER']);
    return result.insertId;
  },
  async syncVIP(id, active) {
    await db.execute('UPDATE NguoiDung SET TrangThaiVIP = ? WHERE MaNguoiDung = ?', [active ? 1 : 0, id]);
  }
};
