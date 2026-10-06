const db = require('../config/db');
const TRIAL_PLAN_NAME = 'Dùng thử VIP 1 ngày';

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
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [result] = await conn.execute(
        'INSERT INTO NguoiDung (HoTen, Email, MatKhau, VaiTro, TrangThaiVIP, TrangThai) VALUES (?, ?, ?, ?, 1, 1)',
        [name, email, hash, 'USER']
      );
      const userId = result.insertId;
      let [plans] = await conn.execute(
        'SELECT MaGoi FROM GoiVIP WHERE TenGoi=? AND ThoiHan=1 AND Gia=0 ORDER BY MaGoi LIMIT 1',
        [TRIAL_PLAN_NAME]
      );
      let planId = plans[0]?.MaGoi;
      if (!planId) {
        const [planResult] = await conn.execute(
          'INSERT INTO GoiVIP (TenGoi, ThoiHan, Gia, MoTa) VALUES (?,1,0,?)',
          [TRIAL_PLAN_NAME, 'VIP dùng thử miễn phí 1 ngày dành cho tài khoản mới.']
        );
        planId = planResult.insertId;
      }
      await conn.execute(`INSERT INTO DangKyVIP
        (MaNguoiDung,MaGoi,NgayBatDau,NgayKetThuc,TrangThai)
        VALUES (?,?,NOW(),DATE_ADD(NOW(),INTERVAL 1 DAY),'DA_XAC_NHAN')`, [userId, planId]);
      await conn.commit();
      return userId;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },
  async syncVIP(id, active) {
    await db.execute('UPDATE NguoiDung SET TrangThaiVIP = ? WHERE MaNguoiDung = ?', [active ? 1 : 0, id]);
  },
  async listAdmin({ search = '', status = 'ALL', limit = 200 } = {}) {
    const where = ["u.VaiTro='USER'"];
    const args = [];
    if (search) {
      where.push('(u.HoTen LIKE ? OR u.Email LIKE ?)');
      args.push(`%${search}%`, `%${search}%`);
    }
    if (status === 'ACTIVE') where.push('u.TrangThai=1');
    if (status === 'LOCKED') where.push('u.TrangThai=0');
    args.push(Math.min(Math.max(Number(limit) || 200, 1), 500));
    const [rows] = await db.query(`SELECT u.MaNguoiDung,u.HoTen,u.Email,u.VaiTro,u.TrangThaiVIP,u.TrangThai,u.LyDoKhoa,u.NgayDangKy,
      EXISTS(SELECT 1 FROM DangKyVIP dv WHERE dv.MaNguoiDung=u.MaNguoiDung AND dv.TrangThai='DA_XAC_NHAN'
        AND dv.NgayBatDau<=NOW() AND dv.NgayKetThuc>NOW()) AS VIPHienTai
      FROM NguoiDung u WHERE ${where.join(' AND ')} ORDER BY u.MaNguoiDung DESC LIMIT ?`, args);
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
