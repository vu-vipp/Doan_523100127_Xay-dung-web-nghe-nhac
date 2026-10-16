const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');

const root = path.resolve(__dirname, '..');
const resultDir = path.join(root, 'test-results');
const resultFile = path.join(resultDir, 'test-results.json');

const fakeDb = {
  query: async () => [[]],
  execute: async () => [[]],
  getConnection: async () => { throw new Error('getConnection mock not configured'); }
};

const dbPath = require.resolve('../config/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb };

const Song = require('../models/SongModel');
const User = require('../models/UserModel');
const VIP = require('../models/VIPModel');
const AuthController = require('../controllers/AuthController');

const results = {};

async function test(id, name, expected, fn) {
  try {
    const actual = await fn();
    results[id] = { name, expected, actual, status: 'PASS' };
    console.log(`PASS ${id} - ${name}`);
  } catch (error) {
    results[id] = {
      name,
      expected,
      actual: `Lỗi khi chạy test: ${error.message}`,
      status: 'FAIL'
    };
    console.error(`FAIL ${id} - ${name}`);
    console.error(error);
  }
}

function makeRes() {
  return {
    redirectUrl: null,
    statusCode: 200,
    body: null,
    redirect(url) { this.redirectUrl = url; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    render() { return this; },
    sendStatus(code) { this.statusCode = code; return this; }
  };
}

(async () => {
  await test(
    'TC01',
    'Đăng ký tài khoản hợp lệ',
    'Tạo tài khoản thành công, chuyển sang /login và hiển thị thông báo đăng ký thành công.',
    async () => {
      const oldFind = User.findByEmail;
      const oldCreate = User.create;
      try {
        User.findByEmail = async () => null;
        User.create = async () => 101;
        const req = {
          body: { name: 'Auto Test', email: 'autotest@wave.local', password: '12345678' },
          session: {}
        };
        const res = makeRes();
        let nextError = null;
        await AuthController.register(req, res, err => { nextError = err; });
        if (nextError) throw nextError;
        assert.equal(res.redirectUrl, '/login');
        assert.equal(req.session.flash?.type, 'success');
        assert.match(req.session.flash?.message || '', /Đăng ký thành công/);
        return `Redirect /login. Thông báo: "${req.session.flash.message}"`;
      } finally {
        User.findByEmail = oldFind;
        User.create = oldCreate;
      }
    }
  );

  await test(
    'TC02',
    'Đăng nhập hợp lệ',
    'Đăng nhập thành công, tạo session và chuyển về trang chủ.',
    async () => {
      const oldFind = User.findByEmail;
      try {
        const hash = await bcrypt.hash('12345678', 4);
        User.findByEmail = async () => ({
          MaNguoiDung: 7,
          HoTen: 'Auto Test',
          Email: 'autotest@wave.local',
          MatKhau: hash,
          VaiTro: 'USER',
          TrangThai: 1,
          LyDoKhoa: null
        });
        const session = {
          regenerate(cb) { cb(); },
          save(cb) { cb(); }
        };
        const req = {
          body: { email: 'autotest@wave.local', password: '12345678' },
          session
        };
        const res = makeRes();
        let nextError = null;
        await AuthController.login(req, res, err => { nextError = err; });
        if (nextError) throw nextError;
        assert.equal(req.session.userId, 7);
        assert.equal(res.redirectUrl, '/');
        assert.equal(req.session.flash?.type, 'success');
        assert.equal(req.session.flash?.message, 'Chào mừng Auto Test!');
        return `Redirect /. Session userId=7. Thông báo: "${req.session.flash.message}"`;
      } finally {
        User.findByEmail = oldFind;
      }
    }
  );

  await test(
    'TC03',
    'Đăng nhập sai mật khẩu',
    'Hệ thống từ chối đăng nhập và hiển thị thông báo lỗi.',
    async () => {
      const oldFind = User.findByEmail;
      try {
        const hash = await bcrypt.hash('12345678', 4);
        User.findByEmail = async () => ({
          MaNguoiDung: 7,
          HoTen: 'Auto Test',
          Email: 'autotest@wave.local',
          MatKhau: hash,
          VaiTro: 'USER',
          TrangThai: 1
        });
        const req = {
          body: { email: 'autotest@wave.local', password: 'sai-mat-khau' },
          session: {}
        };
        const res = makeRes();
        let nextError = null;
        await AuthController.login(req, res, err => { nextError = err; });
        if (nextError) throw nextError;
        assert.equal(res.redirectUrl, '/login');
        assert.equal(req.session.flash?.type, 'warning');
        assert.equal(req.session.flash?.message, 'Email hoặc mật khẩu không chính xác.');
        return `Redirect /login. Thông báo: "${req.session.flash.message}"`;
      } finally {
        User.findByEmail = oldFind;
      }
    }
  );

  await test(
    'TC04',
    'Schema có đúng 9 bảng nghiệp vụ',
    'CSDL khai báo đúng 9 bảng theo thiết kế WAVE Music.',
    async () => {
      const sql = fs.readFileSync(path.join(root, 'database/schema.sql'), 'utf8');
      const names = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map(m => m[1]);
      const expectedNames = ['NguoiDung','CaSi','TheLoai','Album','BaiHat','Playlist','ChiTietPlaylist','GoiVIP','DangKyVIP'];
      assert.deepEqual(names, expectedNames);
      return `Tìm thấy 9/9 bảng: ${names.join(', ')}`;
    }
  );

  await test(
    'TC05',
    'Admin khóa và mở khóa USER',
    'Khóa dùng TrangThai=0 + LyDoKhoa; mở khóa dùng TrangThai=1 + LyDoKhoa=NULL.',
    async () => {
      const calls = [];
      fakeDb.execute = async (sql, args) => { calls.push({ sql, args }); return [{ affectedRows: 1 }]; };
      assert.equal(await User.lock(7, 'vi phạm'), 1);
      assert.match(calls[0].sql, /TrangThai=0/);
      assert.match(calls[0].sql, /LyDoKhoa=\?/);
      assert.deepEqual(calls[0].args, ['vi phạm', 7]);
      assert.equal(await User.unlock(7), 1);
      assert.match(calls[1].sql, /TrangThai=1/);
      assert.match(calls[1].sql, /LyDoKhoa=NULL/);
      return 'Khóa USER cập nhật TrangThai=0 và lý do; mở khóa cập nhật TrangThai=1 và xóa LyDoKhoa.';
    }
  );

  await test(
    'TC06',
    'Danh sách USER phân trang 10 bản ghi và giữ bộ lọc',
    'Truy vấn có tìm kiếm, lọc trạng thái và LIMIT/OFFSET đúng 10 bản ghi.',
    async () => {
      let captured = null;
      fakeDb.query = async (sql, args) => { captured = { sql, args }; return [[]]; };
      await User.listAdmin({ search: 'huy', status: 'LOCKED', limit: 10, offset: 10 });
      assert.match(captured.sql, /HoTen LIKE \? OR u\.Email LIKE \?/);
      assert.match(captured.sql, /u\.TrangThai=0/);
      assert.match(captured.sql, /LIMIT \? OFFSET \?/);
      assert.deepEqual(captured.args, ['%huy%', '%huy%', 10, 10]);
      return 'SQL áp dụng search="huy", trạng thái LOCKED, LIMIT 10, OFFSET 10.';
    }
  );

  await test(
    'TC07',
    'Ca sĩ nhập text: dùng lại nếu có, tự tạo nếu chưa có',
    'Tên ca sĩ được chuẩn hóa; nếu tồn tại thì dùng lại, nếu chưa có thì INSERT mới.',
    async () => {
      let mode = 'existing';
      const calls = [];
      fakeDb.execute = async (sql, args) => {
        calls.push({ sql, args });
        if (/SELECT MaCaSi FROM CaSi/.test(sql)) return mode === 'existing' ? [[{ MaCaSi: 5 }]] : [[]];
        if (/INSERT INTO CaSi/.test(sql)) return [{ insertId: 9 }];
        throw new Error('SQL không mong đợi: ' + sql);
      };
      const existingId = await Song.findOrCreateArtist('  Sơn   Tùng  ');
      assert.equal(existingId, 5);
      assert.equal(calls[0].args[0], 'Sơn Tùng');
      mode = 'new';
      const newId = await Song.findOrCreateArtist('Ca sĩ mới');
      assert.equal(newId, 9);
      assert.ok(calls.some(c => /INSERT INTO CaSi/.test(c.sql) && c.args[0] === 'Ca sĩ mới'));
      return 'Tên "  Sơn   Tùng  " được chuẩn hóa thành "Sơn Tùng" và dùng MaCaSi=5; "Ca sĩ mới" được tạo với MaCaSi=9.';
    }
  );

  await test(
    'TC08',
    'Gói FREE 1 ngày chỉ hiện khi chưa từng có lịch sử VIP',
    'Truy vấn gói FREE 1 ngày có điều kiện NOT EXISTS lịch sử DangKyVIP.',
    async () => {
      let captured = null;
      fakeDb.execute = async (sql, args) => { captured = { sql, args }; return [[]]; };
      await VIP.plans(12);
      assert.match(captured.sql, /g\.Gia = 0 AND g\.ThoiHan = 1/);
      assert.match(captured.sql, /NOT EXISTS/);
      assert.match(captured.sql, /DangKyVIP/);
      assert.deepEqual(captured.args, [12]);
      return 'SQL kiểm tra gói Gia=0, ThoiHan=1 và NOT EXISTS lịch sử DangKyVIP của userId=12.';
    }
  );

  await test(
    'TC09',
    'Nhận FREE 1 ngày',
    'Tạo DangKyVIP ở trạng thái DA_XAC_NHAN, hiệu lực +1 ngày và bật TrangThaiVIP.',
    async () => {
      const sqlCalls = [];
      let committed = false;
      const conn = {
        async beginTransaction() {},
        async rollback() {},
        async commit() { committed = true; },
        release() {},
        async execute(sql, args) {
          sqlCalls.push({ sql, args });
          if (/SELECT MaNguoiDung/.test(sql)) return [[{ MaNguoiDung: 3 }]];
          if (/SELECT \* FROM GoiVIP/.test(sql)) return [[{ MaGoi: 1, Gia: 0, ThoiHan: 1 }]];
          if (/SELECT MaDangKy FROM DangKyVIP/.test(sql)) return [[]];
          if (/INSERT INTO DangKyVIP/.test(sql)) return [{ affectedRows: 1 }];
          if (/UPDATE NguoiDung SET TrangThaiVIP=1/.test(sql)) return [{ affectedRows: 1 }];
          throw new Error('SQL không mong đợi: ' + sql);
        }
      };
      fakeDb.getConnection = async () => conn;
      const status = await VIP.claimTrial(3, 1);
      assert.equal(status, 'activated');
      assert.equal(committed, true);
      const insert = sqlCalls.find(c => /INSERT INTO DangKyVIP/.test(c.sql));
      assert.ok(insert);
      assert.match(insert.sql, /DA_XAC_NHAN/);
      assert.match(insert.sql, /INTERVAL 1 DAY/);
      assert.ok(sqlCalls.some(c => /UPDATE NguoiDung SET TrangThaiVIP=1/.test(c.sql)));
      return 'Kết quả activated; INSERT DangKyVIP=DA_XAC_NHAN, NgayKetThuc=NOW()+1 DAY; TrangThaiVIP=1; transaction COMMIT.';
    }
  );

  await test(
    'TC10',
    'Soft Delete và Restore bài hát',
    'Khóa bài hát bằng TrangThai=0, khôi phục bằng TrangThai=1 và không DELETE dữ liệu.',
    async () => {
      const calls = [];
      fakeDb.execute = async (sql, args) => { calls.push({ sql, args }); return [{ affectedRows: 1 }]; };
      assert.equal(await Song.remove(11), 1);
      assert.match(calls[0].sql, /UPDATE BaiHat SET TrangThai=0/);
      assert.doesNotMatch(calls[0].sql, /DELETE FROM/i);
      assert.equal(await Song.restore(11), 1);
      assert.match(calls[1].sql, /UPDATE BaiHat SET TrangThai=1/);
      return 'Bài hát 11: Soft Delete cập nhật TrangThai=0; Restore cập nhật TrangThai=1; không có lệnh DELETE.';
    }
  );

  await test(
    'TC11',
    'Route quản trị đầy đủ',
    'Có route khóa/mở USER, restore bài hát và duyệt VIP.',
    async () => {
      const routes = fs.readFileSync(path.join(root, 'routes/adminRoutes.js'), 'utf8');
      assert.match(routes, /\/admin\/users\/:id\/lock/);
      assert.match(routes, /\/admin\/users\/:id\/unlock/);
      assert.match(routes, /\/admin\/songs\/:id\/restore/);
      assert.match(routes, /\/admin\/vip\/:id\/:action/);
      return 'Đã xác nhận 4 nhóm route quản trị: lock user, unlock user, restore song, approve/reject VIP.';
    }
  );

  await test(
    'TC12',
    'Luồng thanh toán VIP mô phỏng',
    'Có trang thanh toán, xác nhận thanh toán và tạo yêu cầu CHO_XAC_NHAN.',
    async () => {
      const routes = fs.readFileSync(path.join(root, 'routes/vipRoutes.js'), 'utf8');
      const controller = fs.readFileSync(path.join(root, 'controllers/VIPController.js'), 'utf8');
      assert.match(routes, /\/vip\/payment/);
      assert.match(routes, /\/vip\/payment\/confirm/);
      assert.match(controller, /CHO_XAC_NHAN/);
      assert.match(controller, /BANK_TRANSFER/);
      assert.match(controller, /BANK_CARD/);
      return 'Có /vip/payment, /vip/payment/confirm, 2 phương thức BANK_TRANSFER/BANK_CARD và trạng thái CHO_XAC_NHAN.';
    }
  );

  await test(
    'TC13',
    'Form Admin dùng input text cho ca sĩ',
    'Form thêm/sửa bài hát dùng artistName dạng text thay vì artistId cố định.',
    async () => {
      const form = fs.readFileSync(path.join(root, 'views/admin/song-form.ejs'), 'utf8');
      assert.match(form, /name="artistName"/);
      assert.doesNotMatch(form, /name="artistId"/);
      assert.match(form, /tự tạo ca sĩ/i);
      return 'Tìm thấy input name="artistName"; không còn name="artistId"; giao diện có hướng dẫn tự tạo ca sĩ.';
    }
  );

  fs.mkdirSync(resultDir, { recursive: true });
  fs.writeFileSync(resultFile, JSON.stringify(results, null, 2) + '\n', 'utf8');

  const values = Object.values(results);
  const passed = values.filter(r => r.status === 'PASS').length;
  const failed = values.length - passed;

  console.log('');
  console.log(`RESULT: ${passed}/${values.length} test case PASS`);
  console.log(`JSON: ${path.relative(root, resultFile)}`);

  if (failed) {
    console.error(`RESULT: ${failed} test case FAIL`);
    process.exitCode = 1;
  }
})().catch(error => {
  fs.mkdirSync(resultDir, { recursive: true });
  results.FATAL = {
    name: 'Lỗi chạy bộ test',
    expected: 'Bộ test chạy hoàn tất.',
    actual: error.message,
    status: 'FAIL'
  };
  fs.writeFileSync(resultFile, JSON.stringify(results, null, 2) + '\n', 'utf8');
  console.error(error);
  process.exitCode = 1;
});
