const db = require('../config/db');
module.exports = {
  async plans() {
    const [rows] = await db.execute('SELECT * FROM GoiVIP WHERE Gia > 0 ORDER BY Gia, ThoiHan');
    return rows;
  },
  async plan(planId) {
    const [rows] = await db.execute('SELECT * FROM GoiVIP WHERE MaGoi=? LIMIT 1', [planId]);
    return rows[0] || null;
  },
  async prepareCheckout(userId, planId) {
    const [users] = await db.execute('SELECT MaNguoiDung FROM NguoiDung WHERE MaNguoiDung=? LIMIT 1', [userId]);
    if (!users.length) return { status:'missing_user' };
    const plan = await this.plan(planId);
    if (!plan || Number(plan.Gia) <= 0) return { status:'missing_plan' };
    const [existing] = await db.execute(`SELECT MaDangKy FROM DangKyVIP WHERE MaNguoiDung=?
      AND ((TrangThai='DA_XAC_NHAN' AND NgayBatDau<=NOW() AND NgayKetThuc>NOW())
        OR TrangThai='CHO_XAC_NHAN') LIMIT 1`, [userId]);
    if (existing.length) return { status:'existing' };
    return { status:'ready', plan };
  },
  async active(userId) {
    const [rows] = await db.execute(`SELECT dv.*, g.TenGoi FROM DangKyVIP dv
      JOIN GoiVIP g ON g.MaGoi=dv.MaGoi
      WHERE dv.MaNguoiDung=? AND dv.TrangThai='DA_XAC_NHAN'
        AND dv.NgayBatDau<=NOW() AND dv.NgayKetThuc>NOW()
      ORDER BY dv.NgayKetThuc DESC LIMIT 1`, [userId]);
    return rows[0] || null;
  },
  async history(userId) {
    const [rows] = await db.execute(`SELECT dv.*, g.TenGoi, g.Gia FROM DangKyVIP dv
      JOIN GoiVIP g ON g.MaGoi=dv.MaGoi WHERE dv.MaNguoiDung=? ORDER BY dv.MaDangKy DESC`, [userId]);
    return rows;
  },
  async request(userId, planId) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      // Serialize competing requests by the same user through NguoiDung lock.
      const [users] = await conn.execute('SELECT MaNguoiDung FROM NguoiDung WHERE MaNguoiDung=? FOR UPDATE', [userId]);
      if (!users.length) { await conn.rollback(); return 'missing_user'; }
      const [plans] = await conn.execute('SELECT * FROM GoiVIP WHERE MaGoi=?', [planId]);
      if (!plans.length) { await conn.rollback(); return 'missing_plan'; }
      const [active] = await conn.execute(`SELECT MaDangKy FROM DangKyVIP WHERE MaNguoiDung=?
        AND ((TrangThai='DA_XAC_NHAN' AND NgayBatDau<=NOW() AND NgayKetThuc>NOW())
          OR TrangThai='CHO_XAC_NHAN') LIMIT 1`, [userId]);
      if (active.length) { await conn.rollback(); return 'existing'; }
      await conn.execute(`INSERT INTO DangKyVIP
        (MaNguoiDung,MaGoi,NgayBatDau,NgayKetThuc,TrangThai)
        VALUES (?,?,NOW(),DATE_ADD(NOW(),INTERVAL ? DAY),'CHO_XAC_NHAN')`, [userId,planId,plans[0].ThoiHan]);
      await conn.commit();
      return 'created';
    } catch (err) { await conn.rollback(); throw err; }
    finally { conn.release(); }
  },
  async pending() {
    const [rows] = await db.execute(`SELECT dv.*, u.HoTen, u.Email, g.TenGoi, g.ThoiHan, g.Gia
      FROM DangKyVIP dv JOIN NguoiDung u ON u.MaNguoiDung=dv.MaNguoiDung
      JOIN GoiVIP g ON g.MaGoi=dv.MaGoi WHERE dv.TrangThai='CHO_XAC_NHAN'
      ORDER BY dv.MaDangKy ASC`);
    return rows;
  },
  async decide(registrationId, action) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.execute(`SELECT dv.MaDangKy,dv.MaNguoiDung,dv.TrangThai,g.ThoiHan
        FROM DangKyVIP dv JOIN GoiVIP g ON g.MaGoi=dv.MaGoi
        WHERE dv.MaDangKy=? FOR UPDATE`, [registrationId]);
      if (!rows.length || rows[0].TrangThai!=='CHO_XAC_NHAN') { await conn.rollback(); return false; }
      const reg = rows[0];
      if (action === 'approve') {
        const [other] = await conn.execute(`SELECT MaDangKy FROM DangKyVIP WHERE MaNguoiDung=?
          AND TrangThai='DA_XAC_NHAN' AND NgayBatDau<=NOW() AND NgayKetThuc>NOW() LIMIT 1`, [reg.MaNguoiDung]);
        if (other.length) { await conn.rollback(); return false; }
        await conn.execute(`UPDATE DangKyVIP SET TrangThai='DA_XAC_NHAN',NgayBatDau=NOW(),
          NgayKetThuc=DATE_ADD(NOW(),INTERVAL ? DAY) WHERE MaDangKy=?`, [reg.ThoiHan,registrationId]);
        await conn.execute('UPDATE NguoiDung SET TrangThaiVIP=1 WHERE MaNguoiDung=?', [reg.MaNguoiDung]);
      } else if (action === 'reject') {
        await conn.execute("UPDATE DangKyVIP SET TrangThai='HUY' WHERE MaDangKy=?", [registrationId]);
      } else { await conn.rollback(); return false; }
      await conn.commit();
      return true;
    } catch(err) { await conn.rollback(); throw err; }
    finally { conn.release(); }
  }
};
