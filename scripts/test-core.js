const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
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

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log('PASS', name);
  } catch (error) {
    results.push({ name, ok: false, error: error.message });
    console.error('FAIL', name);
    console.error(error);
  }
}

(async () => {
  await test('TC01 - Schema có đúng 9 bảng nghiệp vụ', async () => {
    const sql = fs.readFileSync(path.join(root, 'database/schema.sql'), 'utf8');
    const names = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map(m => m[1]);
    assert.deepEqual(names, ['NguoiDung','CaSi','TheLoai','Album','BaiHat','Playlist','ChiTietPlaylist','GoiVIP','DangKyVIP']);
  });

  await test('TC02 - Admin khóa và mở khóa USER bằng TrangThai/LyDoKhoa', async () => {
    const calls = [];
    fakeDb.execute = async (sql, args) => { calls.push({ sql, args }); return [{ affectedRows: 1 }]; };
    assert.equal(await User.lock(7, 'vi phạm'), 1);
    assert.match(calls[0].sql, /TrangThai=0/);
    assert.match(calls[0].sql, /LyDoKhoa=\?/);
    assert.deepEqual(calls[0].args, ['vi phạm', 7]);
    assert.equal(await User.unlock(7), 1);
    assert.match(calls[1].sql, /TrangThai=1/);
    assert.match(calls[1].sql, /LyDoKhoa=NULL/);
    assert.deepEqual(calls[1].args, [7]);
  });

  await test('TC03 - Danh sách USER phân trang 10 bản ghi và giữ bộ lọc', async () => {
    let captured = null;
    fakeDb.query = async (sql, args) => { captured = { sql, args }; return [[]]; };
    await User.listAdmin({ search: 'huy', status: 'LOCKED', limit: 10, offset: 10 });
    assert.match(captured.sql, /HoTen LIKE \? OR u\.Email LIKE \?/);
    assert.match(captured.sql, /u\.TrangThai=0/);
    assert.match(captured.sql, /LIMIT \? OFFSET \?/);
    assert.deepEqual(captured.args, ['%huy%', '%huy%', 10, 10]);
  });

  await test('TC04 - Ca sĩ nhập text: dùng lại nếu có, tự tạo nếu chưa có', async () => {
    let mode = 'existing';
    const calls = [];
    fakeDb.execute = async (sql, args) => {
      calls.push({ sql, args });
      if (/SELECT MaCaSi FROM CaSi/.test(sql)) return mode === 'existing' ? [[{ MaCaSi: 5 }]] : [[]];
      if (/INSERT INTO CaSi/.test(sql)) return [{ insertId: 9 }];
      throw new Error('SQL không mong đợi: ' + sql);
    };
    assert.equal(await Song.findOrCreateArtist('  Sơn   Tùng  '), 5);
    assert.equal(calls[0].args[0], 'Sơn Tùng');
    mode = 'new';
    assert.equal(await Song.findOrCreateArtist('Ca sĩ mới'), 9);
    assert.ok(calls.some(c => /INSERT INTO CaSi/.test(c.sql) && c.args[0] === 'Ca sĩ mới'));
  });

  await test('TC05 - Gói FREE 1 ngày chỉ hiện khi chưa từng có lịch sử VIP', async () => {
    let captured = null;
    fakeDb.execute = async (sql, args) => { captured = { sql, args }; return [[]]; };
    await VIP.plans(12);
    assert.match(captured.sql, /g\.Gia = 0 AND g\.ThoiHan = 1/);
    assert.match(captured.sql, /NOT EXISTS/);
    assert.match(captured.sql, /DangKyVIP/);
    assert.deepEqual(captured.args, [12]);
  });

  await test('TC06 - Nhận FREE 1 ngày tạo DA_XAC_NHAN và hiệu lực +1 ngày', async () => {
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
    assert.equal(await VIP.claimTrial(3, 1), 'activated');
    assert.equal(committed, true);
    const insert = sqlCalls.find(c => /INSERT INTO DangKyVIP/.test(c.sql));
    assert.ok(insert);
    assert.match(insert.sql, /DA_XAC_NHAN/);
    assert.match(insert.sql, /INTERVAL 1 DAY/);
    assert.ok(sqlCalls.some(c => /UPDATE NguoiDung SET TrangThaiVIP=1/.test(c.sql)));
  });

  await test('TC07 - Soft Delete và Restore bài hát dùng TrangThai, không DELETE', async () => {
    const calls = [];
    fakeDb.execute = async (sql, args) => { calls.push({ sql, args }); return [{ affectedRows: 1 }]; };
    assert.equal(await Song.remove(11), 1);
    assert.match(calls[0].sql, /UPDATE BaiHat SET TrangThai=0/);
    assert.doesNotMatch(calls[0].sql, /DELETE FROM/i);
    assert.equal(await Song.restore(11), 1);
    assert.match(calls[1].sql, /UPDATE BaiHat SET TrangThai=1/);
  });

  await test('TC08 - Route quản trị có khóa/mở USER, restore bài hát và duyệt VIP', async () => {
    const routes = fs.readFileSync(path.join(root, 'routes/adminRoutes.js'), 'utf8');
    assert.match(routes, /\/admin\/users\/:id\/lock/);
    assert.match(routes, /\/admin\/users\/:id\/unlock/);
    assert.match(routes, /\/admin\/songs\/:id\/restore/);
    assert.match(routes, /\/admin\/vip\/:id\/:action/);
  });

  await test('TC09 - Luồng thanh toán mô phỏng tồn tại trước khi tạo yêu cầu VIP', async () => {
    const routes = fs.readFileSync(path.join(root, 'routes/vipRoutes.js'), 'utf8');
    const controller = fs.readFileSync(path.join(root, 'controllers/VIPController.js'), 'utf8');
    assert.match(routes, /\/vip\/payment/);
    assert.match(routes, /\/vip\/payment\/confirm/);
    assert.match(controller, /CHO_XAC_NHAN/);
    assert.match(controller, /BANK_TRANSFER/);
    assert.match(controller, /BANK_CARD/);
  });

  await test('TC10 - Form Admin dùng input text cho ca sĩ', async () => {
    const form = fs.readFileSync(path.join(root, 'views/admin/song-form.ejs'), 'utf8');
    assert.match(form, /name="artistName"/);
    assert.doesNotMatch(form, /name="artistId"/);
    assert.match(form, /tự tạo ca sĩ/i);
  });

  const passed = results.filter(r => r.ok).length;
  const failed = results.length - passed;
  console.log('');
  console.log('RESULT: ' + passed + '/' + results.length + ' test case PASS');
  if (failed) {
    console.error('RESULT: ' + failed + ' test case FAIL');
    process.exitCode = 1;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
